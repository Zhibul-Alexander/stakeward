import type { Address, Blockhash, Nonce, Signature } from '@solana/kit';
import {
  buildTransaction,
  inspectTransaction,
  parseCosignFragment,
  type BlockhashLifetime,
  type ChainClock,
  type NonceLifetime,
  type StakeAccount,
} from '@stakeward/core';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi, type Mock } from 'vitest';
import { initialSigningState, signingReducer, type RoundTx, type SigningEvent, type SigningState } from './machine.ts';
import { SigningView, type SigningActions } from './SigningPanel.tsx';

const MAIN = 'B1agBSrGRgub2jXMJEozYkRLRzFc9HLd5hHjSrCtuXu8' as Address;
const SECOND = '9DpLwZiYboWcwYFVtSjSksfaP9EqVoSuZw7Jofet96fi' as Address;
const S1 = 'AYA9kYsn7XVDTPARBfAuASypyyDGFJw1Xds2vHgW9DfW' as Address;
const S2 = '2Xtq6iZ2mXjxTNsv5FrYCzayG5qYRJwZ6837A1X3TjF6' as Address;
const LOCK_END = 1_807_488_000n; // 12 April 2027
const LIFETIME: BlockhashLifetime = {
  kind: 'blockhash',
  blockhash: 'BZFufDqppShyDDC1njm4fMpRbfnLwrpzzwG6WGgcmsxb' as Blockhash,
  lastValidBlockHeight: 1_150n,
};
const CLOCK: ChainClock = { slot: 64_000n, epochStartTimestamp: 1_790_800_000n, epoch: 850n, unixTimestamp: 1_790_812_800n };

function before(address: Address): StakeAccount {
  return {
    address,
    lamports: 5_000_000_000n,
    kind: 'initialized',
    rentExemptReserve: 1_666_240n,
    staker: MAIN,
    withdrawer: MAIN,
    lockup: { unixTimestamp: 0n, epoch: 0n, custodian: '11111111111111111111111111111111' as Address },
    delegation: null,
  };
}

async function roundTx(stakeAccount: Address): Promise<RoundTx> {
  const { bytes } = buildTransaction(
    { kind: 'protect', stakeAccount, mainKey: MAIN, secondKey: SECOND, lockUntil: LOCK_END },
    { feePayer: MAIN, lifetime: LIFETIME },
  );
  const inspected = await inspectTransaction(bytes);
  if (!inspected.ok) throw new Error(inspected.error.message);
  return { id: stakeAccount, bytes, summary: inspected.summary, lifetime: LIFETIME };
}

let ready: SigningState;
/** Two accounts chosen; the read before building refused one, so the round holds one transaction. */
let oneLeftOut: SigningState;
/** Round 2 of a run in rounds of one: round 1 (S1) landed, S2 is ready to sign. */
let roundTwo: SigningState;

beforeAll(async () => {
  const txs = [await roundTx(S1), await roundTx(S2)];
  const one = (tx: RoundTx): SigningEvent => ({
    type: 'prepared',
    clock: CLOCK,
    jobs: {
      [tx.id]: { id: tx.id, state: { kind: 'ready' }, before: before(tx.id as Address), action: tx.summary.action, lifetime: LIFETIME, signature: null, bytes: tx.bytes },
    },
    txs: [tx],
    steps: [
      { address: MAIN, role: 'main', walletName: 'Main Wallet', count: 1, status: 'pending', local: true },
      { address: SECOND, role: 'second', walletName: 'Second Wallet', count: 1, status: 'pending', local: true },
    ],
  });
  const [tx1, tx2] = txs as [RoundTx, RoundTx];
  const signedBy = (tx: RoundTx, ...signers: Address[]): RoundTx => ({ ...tx, summary: { ...tx.summary, presentSignatures: signers } });
  roundTwo = [
    { type: 'start' } as const,
    one(tx1),
    { type: 'asking', step: 0 } as const,
    { type: 'signed', step: 0, txs: [signedBy(tx1, MAIN)] } as const,
    { type: 'asking', step: 1 } as const,
    { type: 'signed', step: 1, txs: [signedBy(tx1, MAIN, SECOND)] } as const,
    { type: 'job', id: S1, state: { kind: 'confirming', indefinite: false } } as const,
    { type: 'send-done' } as const,
    { type: 'job', id: S1, state: { kind: 'checking' } } as const,
    { type: 'confirm-done' } as const,
    { type: 'job', id: S1, state: { kind: 'done', after: null } } as const,
    { type: 'check-done' } as const,
    one(tx2),
  ].reduce(signingReducer, initialSigningState([S1, S2], 1));
  const prepared: SigningEvent = {
    type: 'prepared',
    clock: CLOCK,
    jobs: Object.fromEntries(
      txs.map((tx) => [
        tx.id,
        { id: tx.id, state: { kind: 'ready' }, before: before(tx.id as Address), action: tx.summary.action, lifetime: LIFETIME, signature: null, bytes: tx.bytes },
      ]),
    ),
    txs,
    steps: [
      { address: MAIN, role: 'main', walletName: 'Main Wallet', count: 2, status: 'pending', local: true },
      { address: SECOND, role: 'second', walletName: 'Second Wallet', count: 2, status: 'pending', local: true },
    ],
  };
  ready = [{ type: 'start' } as const, prepared].reduce(signingReducer, initialSigningState([S1, S2], 2));
  const [first] = txs as [RoundTx, RoundTx];
  oneLeftOut = [
    { type: 'start' } as const,
    {
      type: 'prepared',
      clock: CLOCK,
      jobs: {
        [S1]: { id: S1, state: { kind: 'ready' }, before: before(S1), action: first.summary.action, lifetime: LIFETIME, signature: null, bytes: first.bytes },
        [S2]: { id: S2, state: { kind: 'refused', reason: 'locked-by-other' }, before: before(S2), action: null, lifetime: null, signature: null, bytes: null },
      },
      txs: [first],
      steps: [
        { address: MAIN, role: 'main', walletName: 'Main Wallet', count: 1, status: 'pending', local: true },
        { address: SECOND, role: 'second', walletName: 'Second Wallet', count: 1, status: 'pending', local: true },
      ],
    } as const,
  ].reduce(signingReducer, initialSigningState([S1, S2], 2));
});

const reduce = (state: SigningState, ...events: SigningEvent[]): SigningState => events.reduce(signingReducer, state);

type ActionSpies = { [K in keyof SigningActions]: Mock<SigningActions[K]> };

function actions(): ActionSpies {
  return {
    sign: vi.fn<SigningActions['sign']>(),
    continueWithWallet: vi.fn<SigningActions['continueWithWallet']>(),
    continueAfterSwitch: vi.fn<SigningActions['continueAfterSwitch']>(),
    stopWaiting: vi.fn<SigningActions['stopWaiting']>(),
    restartRound: vi.fn<SigningActions['restartRound']>(),
    oneAtATime: vi.fn<SigningActions['oneAtATime']>(),
    retryPrepare: vi.fn<SigningActions['retryPrepare']>(),
    finish: vi.fn<SigningActions['finish']>(),
    resumeLink: vi.fn<SigningActions['resumeLink']>(),
    checkLinkNow: vi.fn<SigningActions['checkLinkNow']>(),
  };
}

function show(state: SigningState, spy = actions(), onBack = vi.fn()) {
  const renderKeySlot = vi.fn((role: string, _address: Address) => <p data-testid="key-slot">{role}</p>);
  render(
    <SigningView
      state={state}
      actions={spy}
      knownRoles={{ main: MAIN, second: SECOND }}
      renderKeySlot={renderKeySlot}
      onBack={onBack}
      risk={<p data-testid="risk">If you lose the second key, you wait.</p>}
    />,
  );
  return { spy, onBack, renderKeySlot };
}

/** Visible filled buttons (primary and danger), as e2e/screen-metrics.ts counts them. */
function filledButtons(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-slot="button"]')].filter((button) =>
    ['primary', 'danger'].includes(button.dataset['variant'] ?? ''),
  );
}

/** True when `a` comes before `b` in the document. */
function precedes(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

function forbiddenRoleWords(): string[] {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const found: string[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    if (/\b(?:custodian|withdrawer|staker)s?\b/i.test(text)) found.push(text);
  }
  return found;
}

describe('SigningView', () => {
  it('ready(0): the signing order, one summary for the batch, the risk right above one primary action, and Back', async () => {
    const { spy, onBack } = show(ready);
    const summaries = document.querySelectorAll('[data-slot="transaction-summary"]');
    expect(summaries).toHaveLength(1);
    const summary = summaries[0] as HTMLElement;
    expect(summary).toHaveAttribute('data-kind', 'protect');
    expect(within(summary).getByText('Stake accounts (2)')).toBeInTheDocument();
    // The order of signing is the compact list above the summary; the addresses stand in the summary's "Who signs".
    const order = screen.getByRole('list', { name: 'Signatures' });
    expect(order.closest('[data-slot="signer-list"]')).toHaveAttribute('data-variant', 'compact');
    expect(precedes(order, summary)).toBe(true);
    const signers = within(order).getAllByRole('listitem');
    expect(signers.map((item) => item.getAttribute('data-status'))).toEqual(['current', 'waiting']);
    expect(within(order).queryByText(MAIN)).not.toBeInTheDocument();
    expect(within(summary).getByText(MAIN)).toBeInTheDocument();
    // After the summary: the action bar with the risk right above Sign (the one filled button) and Back.
    const bar = document.querySelector('[data-slot="action-bar"]') as HTMLElement;
    expect(precedes(summary, bar)).toBe(true);
    const sign = screen.getByRole('button', { name: 'Sign 2 transactions in Main Wallet as Main key' });
    const risk = within(bar).getByTestId('risk');
    expect(precedes(risk, sign)).toBe(true);
    // The screen trimmed to what matters (owner, 10.10.2026): no "check the summary above" hint.
    expect(screen.queryByText(/^Check the summary above/)).toBeNull();
    // Nothing stands between the risk and the Sign button.
    expect(risk.nextElementSibling).toContainElement(sign);
    expect(filledButtons()).toEqual([sign]);
    expect(sign).toHaveAttribute('data-size', 'lg');
    await userEvent.click(sign);
    expect(spy.sign).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    // UX rule 4: no program words on the signing screen (checked per text node).
    expect(forbiddenRoleWords()).toEqual([]);
  });

  it('after the first signature, Back says that nothing was sent', async () => {
    const signedTxs = ready.round?.txs.map((tx) => ({ ...tx, summary: { ...tx.summary, presentSignatures: [MAIN] } })) ?? [];
    const state = reduce(ready, { type: 'asking', step: 0 }, { type: 'signed', step: 0, txs: signedTxs });
    const { spy } = show(state);
    expect(screen.getByRole('button', { name: 'Stop and go back. Nothing was sent.' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign 2 transactions in Second Wallet as Second key' }));
    expect(spy.sign).toHaveBeenCalledTimes(1);
  });

  it('stopped by a wallet check: offers to start again with that wallet first', async () => {
    const state = reduce(ready, { type: 'asking', step: 0 }, {
      type: 'stopped',
      step: 0,
      reason: {
        kind: 'check',
        walletName: 'Second Wallet',
        code: 'tail-not-first-signer',
        detail: 'appended Lighthouse',
        startWith: SECOND,
        bothWays: false,
      },
    });
    const { spy } = show(state);
    expect(
      screen.getByText('The wallet added its own checks after another wallet had signed, which breaks that signature. Nothing was sent.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start again with Second Wallet signing first' }));
    expect(spy.restartRound).toHaveBeenCalledWith(SECOND);
    await userEvent.click(screen.getByRole('button', { name: 'Start again' }));
    expect(spy.restartRound).toHaveBeenLastCalledWith();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('expired with two transactions: Sign again, or one stake account at a time', async () => {
    const { spy } = show(reduce(ready, { type: 'expired' }));
    expect(screen.getByText('The transaction expired before every wallet signed')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign again' }));
    expect(spy.restartRound).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Sign one stake account at a time' }));
    expect(spy.oneAtATime).toHaveBeenCalledTimes(1);
  });

  it('needs-wallet: the key slot of that role for that address, then an outline "Use this wallet"', async () => {
    const { spy, renderKeySlot } = show(reduce(ready, { type: 'needs-wallet', step: 0 }));
    expect(screen.getByText('Connect your Main key to sign.')).toBeInTheDocument();
    // The slot is told which account the step needs (KeySlot `expected`); the address stands in full in the summary.
    expect(renderKeySlot).toHaveBeenCalledWith('main', MAIN);
    expect(screen.getByTestId('key-slot')).toHaveTextContent('main');
    const summary = document.querySelector('[data-slot="transaction-summary"]') as HTMLElement;
    expect(screen.getAllByText(MAIN).every((node) => summary.contains(node))).toBe(true);
    // The page's slot holds the one filled button (Connect); this one goes on once a wallet here holds the key.
    const use = screen.getByRole('button', { name: 'Use this wallet' });
    expect(use).toHaveAttribute('data-variant', 'outline');
    expect(filledButtons()).toEqual([]);
    expect(screen.queryByTestId('risk')).not.toBeInTheDocument();
    // Before a press it says nothing more; pressed while no wallet here holds the key (the session changes nothing),
    // it says why under the button instead of seeming dead.
    expect(screen.queryByText(/^No wallet here holds your/)).not.toBeInTheDocument();
    await userEvent.click(use);
    expect(spy.continueWithWallet).toHaveBeenCalledTimes(1);
    const why = screen.getByText('No wallet here holds your Main key yet. Connect it above, then press Use this wallet.');
    expect(why.closest('[data-slot="action-bar-reason"]')).not.toBeNull();
  });

  it('names a chosen stake account that is not in the round, with the page\'s reason, before anyone signs', () => {
    render(
      <SigningView
        state={oneLeftOut}
        actions={actions()}
        knownRoles={{ main: MAIN, second: SECOND }}
        renderKeySlot={() => null}
        refusalText={(reason) => `Refused: ${reason}`}
      />,
    );
    const left = document.querySelector('[data-slot="left-out-of-round"]') as HTMLElement;
    expect(left).toHaveTextContent('1 stake account is not in this request:');
    const items = within(left).getAllByRole('listitem');
    expect(items.map((item) => item.getAttribute('data-status'))).toEqual(['left-out']);
    expect(items[0]).toHaveTextContent('Refused: locked-by-other');
    // It comes before the signing order and the summary of the one transaction that is signed.
    const order = screen.getByRole('list', { name: 'Signatures' });
    expect(precedes(left, order)).toBe(true);
    expect(within(order.parentElement as HTMLElement).getByText('Approves 1 transaction')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in Main Wallet as Main key' })).toBeInTheDocument();
    // With every chosen account in the round there is no such list.
    cleanup();
    show(ready);
    expect(document.querySelector('[data-slot="left-out-of-round"]')).toBeNull();
  });

  it('summaryIntro={false} and hideSingleSigner: no intro line, and no signing order while one signer is left', () => {
    const signedTxs = ready.round?.txs.map((tx) => ({ ...tx, summary: { ...tx.summary, presentSignatures: [MAIN] } })) ?? [];
    const lastOne = reduce(ready, { type: 'asking', step: 0 }, { type: 'signed', step: 0, txs: signedTxs });
    const props = { actions: actions(), knownRoles: { main: MAIN, second: SECOND }, renderKeySlot: () => null };
    const { rerender } = render(<SigningView state={lastOne} {...props} summaryIntro={false} hideSingleSigner />);
    expect(screen.queryByText('Read from the exact bytes you sign.')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Signatures' })).not.toBeInTheDocument();
    // "Who signs" still lists both keys and who already signed.
    const summary = document.querySelector('[data-slot="transaction-summary"]') as HTMLElement;
    expect(within(summary).getAllByText('Signed')).toHaveLength(1);
    expect(within(summary).getAllByText('Not signed yet')).toHaveLength(1);

    // Two signers left: each sees whose turn it is.
    rerender(<SigningView state={ready} {...props} summaryIntro={false} hideSingleSigner />);
    expect(screen.getByRole('list', { name: 'Signatures' })).toBeInTheDocument();
    // By default the intro line is left out too (owner, 10.10.2026); a page can still ask for it.
    rerender(<SigningView state={ready} {...props} />);
    expect(screen.queryByText('Read from the exact bytes you sign.')).not.toBeInTheDocument();
    rerender(<SigningView state={ready} {...props} summaryIntro />);
    expect(screen.getByText('Read from the exact bytes you sign.')).toBeInTheDocument();
  });

  it('signing: explains the wait and offers Stop waiting, no Back', async () => {
    const { spy } = show(reduce(ready, { type: 'asking', step: 0 }));
    expect(screen.getByText('Waiting for Main Wallet: approve or reject the request there.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Stop waiting' }));
    expect(spy.stopWaiting).toHaveBeenCalledTimes(1);
  });

  it('starting: the block height read before the wallet is asked is explained and can be stopped, no Back', async () => {
    const { spy } = show(reduce(ready, { type: 'starting', step: 0, waitFor: 'network' }));
    expect(screen.getByText('Checking the network before asking Main Wallet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign 2 transactions in Main Wallet as Main key' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Stop waiting' }));
    expect(spy.stopWaiting).toHaveBeenCalledTimes(1);
  });

  it('starting: a wallet asked to offer the account again is waited for, with Stop waiting and no Continue', async () => {
    const state = reduce(ready, { type: 'switch-account', step: 0, again: false }, { type: 'starting', step: 0, waitFor: 'wallet' });
    const { spy } = show(state);
    expect(screen.getByText('Waiting for Main Wallet: approve or reject the request there.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Stop waiting' }));
    expect(spy.stopWaiting).toHaveBeenCalledTimes(1);
  });

  it('keeps the spinner and the text of a wait together; only the button wraps', () => {
    show(reduce(ready, { type: 'asking', step: 0 }));
    const text = screen.getByText('Waiting for Main Wallet: approve or reject the request there.');
    const group = text.parentElement as HTMLElement;
    expect(group.querySelector('[data-slot="spinner"]')).not.toBeNull();
    expect(group).not.toContainElement(screen.getByRole('button', { name: 'Stop waiting' }));
    expect(group.className).toContain('min-w-0');
    expect(group.className).not.toContain('flex-wrap');
  });

  it('a later round after an earlier one landed: says so, never "Nothing was sent", and stops with the result', async () => {
    const { spy, onBack } = show(roundTwo);
    expect(screen.getByText('Round 2 of 2')).toBeInTheDocument();
    expect(
      screen.getByText('An earlier round already sent the transaction for 1 stake account. What this screen says is about this round only.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Stop here and see the result' }));
    expect(spy.finish).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
  });

  it('a later round stopped by the wallet: "This round was not sent", and Stop here instead of Stop and go back', () => {
    const signedTxs = roundTwo.round?.txs.map((tx) => ({ ...tx, summary: { ...tx.summary, presentSignatures: [MAIN] } })) ?? [];
    const state = reduce(roundTwo, { type: 'asking', step: 0 }, { type: 'signed', step: 0, txs: signedTxs }, { type: 'asking', step: 1 }, {
      type: 'stopped',
      step: 1,
      reason: { kind: 'wallet', walletName: 'Second Wallet', error: { code: 'wallet-rejected', title: 'x', detail: 'd' }, portError: null },
    });
    show(state);
    expect(screen.getByText('This round was not sent')).toBeInTheDocument();
    expect(screen.queryByText('Nothing was sent')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop and go back. Nothing was sent.' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop here and see the result' })).toBeInTheDocument();
  });

  it('a later round that expired: this round was not sent', () => {
    show(reduce(roundTwo, { type: 'expired' }));
    expect(screen.getByText('This round was not sent. Sign again: each wallet approves once more.')).toBeInTheDocument();
    expect(screen.queryByText(/^Nothing was sent/)).not.toBeInTheDocument();
  });

  it('prepare-failed fee-balance: what the key holds and needs, no stale summary; Try again prepares again', async () => {
    const state = reduce(ready, { type: 'refresh' }, {
      type: 'prepare-failed',
      problem: { kind: 'fee-balance', payer: MAIN, role: 'main', balance: 1_000_000n, needed: 2_000_000n },
    });
    const { spy } = show(state);
    expect(screen.getByText(/^Your Main key has 0\.001 SOL\. It needs at least 0\.002 SOL/)).toBeInTheDocument();
    expect(document.querySelectorAll('[data-slot="transaction-summary"]')).toHaveLength(0);
    expect(screen.queryByRole('list', { name: 'Signatures' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(spy.retryPrepare).toHaveBeenCalledTimes(1);
  });

  it('sending: each stake account with its status', () => {
    const signedTxs = ready.round?.txs.map((tx) => ({ ...tx, summary: { ...tx.summary, presentSignatures: [MAIN, SECOND] } })) ?? [];
    const state = reduce(
      ready,
      { type: 'asking', step: 0 },
      { type: 'signed', step: 0, txs: signedTxs },
      { type: 'asking', step: 1 },
      { type: 'signed', step: 1, txs: signedTxs },
      { type: 'job', id: S1, state: { kind: 'sending' } },
    );
    show(state);
    expect(screen.getByText('Sending to the network: 1 of 2')).toBeInTheDocument();
    const jobs = within(screen.getByRole('list', { name: 'Stake accounts' })).getAllByRole('listitem');
    expect(jobs.map((item) => item.getAttribute('data-status'))).toEqual(['sending', 'waiting']);
  });

  it('without onBack there is no Back button (/cosign), while Stop here still ends a run that has a result', () => {
    const spy = actions();
    const props = { actions: spy, knownRoles: { main: MAIN, second: SECOND }, renderKeySlot: () => null };
    const { rerender } = render(<SigningView state={ready} {...props} />);
    expect(screen.getByRole('button', { name: 'Sign 2 transactions in Main Wallet as Main key' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();

    const signedTxs = ready.round?.txs.map((tx) => ({ ...tx, summary: { ...tx.summary, presentSignatures: [MAIN] } })) ?? [];
    rerender(<SigningView state={reduce(ready, { type: 'asking', step: 0 }, { type: 'signed', step: 0, txs: signedTxs })} {...props} />);
    expect(screen.queryByRole('button', { name: 'Stop and go back. Nothing was sent.' })).not.toBeInTheDocument();

    const failed = reduce(ready, { type: 'refresh' }, {
      type: 'prepare-failed',
      problem: { kind: 'read', error: { code: 'network', title: 'x', detail: 'd' } },
    });
    rerender(<SigningView state={failed} {...props} />);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();

    rerender(<SigningView state={roundTwo} {...props} />);
    expect(screen.getByRole('button', { name: 'Stop here and see the result' })).toBeInTheDocument();
  });
});

describe('SigningView confirm (a required checkbox before any wallet is asked)', () => {
  const LABEL = 'The owner told me they want this';
  const props = (spy: SigningActions) => ({
    actions: spy,
    knownRoles: { main: MAIN, second: SECOND },
    renderKeySlot: () => null,
    onBack: vi.fn(),
    confirm: { label: LABEL },
  });

  it('Sign stays aria-disabled until the box is ticked; pressing it says why, focuses the box and asks no wallet', async () => {
    const spy = actions();
    render(<SigningView state={ready} {...props(spy)} />);
    const sign = screen.getByRole('button', { name: 'Sign 2 transactions in Main Wallet as Main key' });
    const box = screen.getByRole('checkbox', { name: LABEL });
    expect(box).not.toBeChecked();
    expect(box).toBeRequired();
    expect(sign).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByText('Tick the box above to continue.')).not.toBeInTheDocument();

    await userEvent.click(sign);
    expect(spy.sign).not.toHaveBeenCalled();
    expect(screen.getByText('Tick the box above to continue.')).toBeInTheDocument();
    expect(box).toHaveFocus();
    expect(box).toHaveAccessibleDescription('Tick the box above to continue.');
    expect(sign).toHaveAccessibleDescription('Tick the box above to continue.');

    await userEvent.click(box);
    expect(box).toBeChecked();
    expect(sign).not.toHaveAttribute('aria-disabled');
    expect(screen.queryByText('Tick the box above to continue.')).not.toBeInTheDocument();
    await userEvent.click(sign);
    expect(spy.sign).toHaveBeenCalledTimes(1);
  });

  it('the keyboard path is the same: Enter on Sign before ticking does not sign', async () => {
    const spy = actions();
    render(<SigningView state={ready} {...props(spy)} />);
    screen.getByRole('button', { name: 'Sign 2 transactions in Main Wallet as Main key' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(spy.sign).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: LABEL })).toHaveFocus();
    await userEvent.keyboard(' ');
    expect(screen.getByRole('checkbox', { name: LABEL })).toBeChecked();
  });

  it('holds for every signer of the round and starts unticked in the next round', async () => {
    const spy = actions();
    const { rerender } = render(<SigningView state={ready} {...props(spy)} />);
    await userEvent.click(screen.getByRole('checkbox', { name: LABEL }));

    // The next signer of the same round, after a wait for the first wallet.
    const signedTxs = ready.round?.txs.map((tx) => ({ ...tx, summary: { ...tx.summary, presentSignatures: [MAIN] } })) ?? [];
    const asking = reduce(ready, { type: 'asking', step: 0 });
    rerender(<SigningView state={asking} {...props(spy)} />);
    expect(screen.queryByRole('checkbox', { name: LABEL })).not.toBeInTheDocument();
    rerender(<SigningView state={reduce(asking, { type: 'signed', step: 0, txs: signedTxs })} {...props(spy)} />);
    expect(screen.getByRole('checkbox', { name: LABEL })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Sign 2 transactions in Second Wallet as Second key' })).not.toHaveAttribute('aria-disabled');

    // A new round (roundNumber 2): ticked again before anything is signed.
    rerender(<SigningView state={roundTwo} {...props(spy)} />);
    expect(screen.getByRole('checkbox', { name: LABEL })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Sign in Main Wallet as Main key' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('without confirm there is no checkbox and Sign is not aria-disabled', () => {
    show(ready);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign 2 transactions in Main Wallet as Main key' })).not.toHaveAttribute('aria-disabled');
  });
});

describe('SigningView: signing by link', () => {
  const NONCE: NonceLifetime = {
    kind: 'nonce',
    nonceAccount: '5xot9PVkphiX2adznghwrAuxGs2zeWisNSxMW6hU6Hkj' as Address,
    nonceAuthority: MAIN,
    nonceValue: 'GfnhkAa2bfg4dTjLfwhLSWg1b8zrJw9u8jCmVSUJhy9Y' as Nonce,
  };
  const TX_ID = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW' as Signature;
  let linkTx: RoundTx;
  let watching: SigningState;

  beforeAll(async () => {
    const { bytes } = buildTransaction(
      { kind: 'protect', stakeAccount: S1, mainKey: MAIN, secondKey: SECOND, lockUntil: LOCK_END },
      { feePayer: MAIN, lifetime: NONCE },
    );
    const inspected = await inspectTransaction(bytes);
    if (!inspected.ok) throw new Error(inspected.error.message);
    linkTx = { id: S1, bytes, summary: inspected.summary, lifetime: NONCE };
    const signedTx: RoundTx = { ...linkTx, summary: { ...linkTx.summary, presentSignatures: [MAIN] } };
    watching = reduce(
      initialSigningState([S1], 1),
      { type: 'start' },
      {
        type: 'prepared',
        clock: CLOCK,
        jobs: { [S1]: { id: S1, state: { kind: 'ready' }, before: before(S1), action: linkTx.summary.action, lifetime: NONCE, signature: null, bytes } },
        txs: [linkTx],
        steps: [
          { address: MAIN, role: 'main', walletName: 'Main Wallet', count: 1, status: 'pending', local: true },
          { address: SECOND, role: 'second', walletName: null, count: 1, status: 'pending', local: false },
        ],
      },
      { type: 'asking', step: 0 },
      { type: 'signed', step: 0, txs: [signedTx], signature: TX_ID },
    );
  });

  function showLink(state: SigningState, spy = actions()) {
    const onBack = vi.fn();
    const view = render(
      <SigningView
        state={state}
        actions={spy}
        knownRoles={{ main: MAIN, second: SECOND }}
        renderKeySlot={() => null}
        onBack={onBack}
        renderLinkCancel={() => <button type="button">Cancel the link (page slot)</button>}
      />,
    );
    return { spy, onBack, view };
  }

  it('link (watching): the card first, with the link, the key that signs by link and the transaction; Stop waiting here', async () => {
    const user = userEvent.setup();
    const { spy, onBack } = showLink(watching);
    // The card leads the panel; the summary of what was signed here follows, folded, then who signs where.
    const panel = document.querySelector('[data-slot="signing-panel"]') as HTMLElement;
    expect(panel).toHaveAttribute('data-phase', 'link');
    expect(panel.firstElementChild).toHaveAttribute('data-slot', 'link-card');
    const folded = panel.querySelector('details[data-slot="disclosure"]') as HTMLDetailsElement;
    expect(folded.open).toBe(false);
    expect(within(folded).getByText('What the other device will sign')).toBeInTheDocument();
    expect(folded.querySelector('[data-slot="transaction-summary"][data-kind="protect"]')).not.toBeNull();
    expect(panel.querySelector('[data-slot="link-signers"]')).toHaveTextContent('Main key signed here · Second key signs on the other device');
    expect(screen.getByRole('heading', { level: 3, name: 'Send this link to your Second key' })).toBeInTheDocument();
    const url = screen.getByLabelText('Signing link');
    expect(url).toHaveAttribute('readonly');
    const link = new URL((url as HTMLInputElement).value);
    expect(link.origin).toBe(window.location.origin);
    expect(link.pathname).toBe('/cosign');
    expect(parseCosignFragment(link.hash)).toEqual(linkTx.bytes);
    const card = document.querySelector('[data-slot="link-card"]') as HTMLElement;
    expect(within(card).getByText(SECOND)).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: /on Solana Explorer/ })).toHaveAttribute(
      'href',
      expect.stringContaining(`/tx/${TX_ID}`),
    );
    const status = card.querySelector('[data-slot="link-status"]');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveTextContent('Waiting for the other device');
    expect(within(card).getByText('This page checks the network every few seconds.')).toBeInTheDocument();
    // Cancel opens inside the card (the page's slot), nothing else asks first.
    expect(within(card).queryByRole('button', { name: 'Cancel the link (page slot)' })).not.toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Cancel the link' }));
    expect(within(card).getByRole('button', { name: 'Cancel the link' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(card).getByRole('button', { name: 'Cancel the link (page slot)' })).toBeInTheDocument();
    // The one filled button is Copy link; the signing order list is replaced by the line above.
    expect([...document.querySelectorAll('[data-slot="button"][data-variant="primary"]')].map((b) => b.textContent)).toEqual(['Copy link']);
    expect(screen.queryByRole('list', { name: 'Signatures' })).not.toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /Back|Stop here/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop waiting here' }));
    expect(spy.stopWaiting).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
    expect(forbiddenRoleWords()).toEqual([]);
  });

  it('link: a failed check says so; paused offers Check again (a new watch) and Stop waiting here', async () => {
    const user = userEvent.setup();
    const { view } = showLink(reduce(watching, { type: 'link-checked', ok: false }));
    expect(document.querySelector('[data-slot="link-status"]')).toHaveTextContent('Network unreachable, still trying');
    view.unmount();

    const { spy } = showLink(reduce(watching, { type: 'link-paused' }));
    expect(document.querySelector('[data-slot="link-status"]')).toHaveTextContent('Stopped checking');
    expect(screen.getByText('Stopped checking after 30 minutes. The link still works.')).toBeInTheDocument();
    expect(screen.queryByText(/Waiting for the other device/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(spy.resumeLink).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Stop waiting here' }));
    expect(spy.stopWaiting).toHaveBeenCalledTimes(1);
  });

  it('back on the tab while a link is open: checks the link now; never on a hidden tab or without a link', () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    const changed = () => {
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
    };
    const spy = actions();
    const props = { actions: spy, knownRoles: { main: MAIN, second: SECOND }, renderKeySlot: () => null };
    const { rerender, unmount } = render(<SigningView state={watching} {...props} />);
    visibility.mockReturnValue('hidden');
    changed();
    expect(spy.checkLinkNow).not.toHaveBeenCalled();
    visibility.mockReturnValue('visible');
    changed();
    expect(spy.checkLinkNow).toHaveBeenCalledTimes(1);

    rerender(<SigningView state={reduce(watching, { type: 'stop-waiting' })} {...props} />);
    changed();
    rerender(<SigningView state={ready} {...props} />);
    changed();
    expect(spy.checkLinkNow).toHaveBeenCalledTimes(1);
    unmount();
    visibility.mockRestore();
  });

  it('prepare-failed nonce missing after an earlier round was reported (the link was cancelled): see the result, no "Go back"', async () => {
    const user = userEvent.setup();
    const signedTx: RoundTx = { ...linkTx, summary: { ...linkTx.summary, presentSignatures: [MAIN] } };
    const failed = reduce(
      initialSigningState([S1, S2], 1),
      { type: 'start' },
      {
        type: 'prepared',
        clock: CLOCK,
        jobs: {
          [S1]: { id: S1, state: { kind: 'ready' }, before: before(S1), action: linkTx.summary.action, lifetime: NONCE, signature: null, bytes: linkTx.bytes },
        },
        txs: [linkTx],
        steps: [
          { address: MAIN, role: 'main', walletName: 'Main Wallet', count: 1, status: 'pending', local: true },
          { address: SECOND, role: 'second', walletName: null, count: 1, status: 'pending', local: false },
        ],
      },
      { type: 'asking', step: 0 },
      { type: 'signed', step: 0, txs: [signedTx], signature: TX_ID },
      { type: 'link-result', id: S1, state: { kind: 'expired' } },
      { type: 'prepare-failed', problem: { kind: 'nonce', state: 'missing' } },
    );
    expect(failed.phase).toEqual({ kind: 'prepare-failed', problem: { kind: 'nonce', state: 'missing' } });
    const { spy, onBack } = showLink(failed);
    expect(
      screen.getByText(
        'Your link-signing account is gone, so this run cannot sign the rest by link. See the result, then try the rest again: you can set the account up again there.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Go back/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop here and see the result' }));
    expect(spy.finish).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', 'Your link-signing account is missing. Go back and set it up again.', false],
    ['unusable', 'Your link-signing account cannot be used. Go back and sign in this browser instead.', false],
    ['stale', 'The network has not caught up with your last transaction yet. Try again in a few seconds.', true],
  ] as const)('prepare-failed nonce %s: says what to do; Try again only for a lagging node', async (state, text, retry) => {
    const user = userEvent.setup();
    const failed = reduce(initialSigningState([S1], 1), { type: 'start' }, { type: 'prepare-failed', problem: { kind: 'nonce', state } });
    const { spy, onBack } = showLink(failed);
    expect(screen.getByText(text)).toBeInTheDocument();
    if (retry) {
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(spy.retryPrepare).toHaveBeenCalledTimes(1);
    } else {
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    }
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
