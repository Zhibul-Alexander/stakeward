import type { Address, Blockhash } from '@solana/kit';
import { buildTransaction, inspectTransaction, type BlockhashLifetime, type ChainClock, type StakeAccount } from '@stakeward/core';
import { render, screen, within } from '@testing-library/react';
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
const CLOCK: ChainClock = { slot: 64_000n, epoch: 850n, unixTimestamp: 1_790_812_800n };

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
      { address: MAIN, role: 'main', walletName: 'Main Wallet', count: 1, status: 'pending' },
      { address: SECOND, role: 'second', walletName: 'Second Wallet', count: 1, status: 'pending' },
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
      { address: MAIN, role: 'main', walletName: 'Main Wallet', count: 2, status: 'pending' },
      { address: SECOND, role: 'second', walletName: 'Second Wallet', count: 2, status: 'pending' },
    ],
  };
  ready = [{ type: 'start' } as const, prepared].reduce(signingReducer, initialSigningState([S1, S2], 2));
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
  };
}

function show(state: SigningState, spy = actions(), onBack = vi.fn()) {
  const renderKeySlot = vi.fn((role: string) => <p data-testid="key-slot">{role}</p>);
  render(
    <SigningView state={state} actions={spy} knownRoles={{ main: MAIN, second: SECOND }} renderKeySlot={renderKeySlot} onBack={onBack} />,
  );
  return { spy, onBack, renderKeySlot };
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
  it('ready(0): one summary for the batch, the signers in order, one primary action and Back', async () => {
    const { spy, onBack } = show(ready);
    const summaries = document.querySelectorAll('[data-slot="transaction-summary"]');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toHaveAttribute('data-kind', 'protect');
    expect(within(summaries[0] as HTMLElement).getByText('Stake accounts (2)')).toBeInTheDocument();
    const signers = within(screen.getByRole('list', { name: 'Signatures' })).getAllByRole('listitem');
    expect(signers.map((item) => item.getAttribute('data-status'))).toEqual(['current', 'waiting']);
    expect(screen.getByText('Check the summary above, then approve the request in Main Wallet.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign 2 transactions in Main Wallet as Main key' }));
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

  it('needs-wallet: the full address and the key slot of that role, then Continue', async () => {
    const { spy, renderKeySlot } = show(reduce(ready, { type: 'needs-wallet', step: 0 }));
    expect(screen.getByText('Connect your Main key to continue: it must sign these transactions.')).toBeInTheDocument();
    expect(renderKeySlot).toHaveBeenCalledWith('main');
    expect(screen.getByTestId('key-slot')).toHaveTextContent('main');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(spy.continueWithWallet).toHaveBeenCalledTimes(1);
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
});
