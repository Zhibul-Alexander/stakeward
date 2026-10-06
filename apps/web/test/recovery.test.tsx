// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit';
import {
  commandDisplayLines,
  commandLine,
  formatUtcDate,
  formatUtcDateTime,
  recoveryCommands,
  ZERO_ADDRESS,
  type Lockup,
} from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { START_EPOCH, START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderStakePage, SCENARIO_TIMEOUT, WAIT } from './support/stake-pages.tsx';

// /recovery/:account (CLAUDE.md section 9): the printable card of one stake account, read from the chain with no
// wallet. Its commands are the core templates (scripts/recovery-cli runs them) with this account filled in.

const DAY = 86_400n;
const T = START_UNIX_TIMESTAMP + 100n * DAY;

type World = { testChain: TestChain; chain: LiteSvmChain; A: KeyPairSigner; K: Address };

async function world(): Promise<World> {
  const testChain = await TestChain.create();
  const [A, K] = await Promise.all([testChain.fundedKey(), generateKeyPairSigner()]);
  return { testChain, chain: new LiteSvmChain(testChain), A, K: K.address };
}

function stake(w: World, lockup: Lockup, staker: Address = w.A.address): Promise<Address> {
  return w.testChain.createStakeAccount({ staker, withdrawer: w.A.address, lockup });
}

/** The text of a command block as shown, line breaks included. */
function shownCommands(): string[] {
  return [...document.querySelectorAll('[data-slot="command-block"] pre code')].map((code) => code.textContent);
}

describe('/recovery/:account: the recovery card', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it(
    'a protected account: both keys in full, the lock end, and every command with this account filled in',
    async () => {
      const w = await world();
      const S = await stake(w, { unixTimestamp: T, epoch: 0n, custodian: w.K });
      const { view } = renderStakePage(w.chain, `/recovery/${S}`, []);

      expect(await view.findByRole('heading', { level: 1, name: 'Recovery card' })).toBeInTheDocument();
      const facts = within(await view.findByRole('region', { name: 'This stake account' }, WAIT));
      for (const [term, address] of [
        ['Stake account', S],
        ['Main key', w.A.address],
        ['Second key', w.K],
      ] as const) {
        const row = facts.getByText(term, { selector: 'dt' }).parentElement as HTMLElement;
        // Full addresses (UX rule 9 for what the reader types or checks by eye), never shortened.
        expect(within(row).getByText(address)).toBeInTheDocument();
      }
      expect(facts.queryByText('Staking managed by')).not.toBeInTheDocument();
      expect(facts.getByText(formatUtcDateTime(T) ?? '')).toBeInTheDocument();
      expect(facts.getByText('Solana devnet (a test network, no real SOL)', { selector: 'p' })).toBeInTheDocument();
      expect(screen.getByText(`If you lose the second key, you wait until ${formatUtcDate(T) ?? ''} to withdraw or rescue this stake.`)).toBeInTheDocument();

      const templates = recoveryCommands({ mainKeyAddress: w.A.address, url: 'devnet' });
      const shown = shownCommands();
      for (const id of ['find', 'rescue', 'deactivate', 'epoch', 'withdraw', 'extend', 'remove-lock', 'change-second-key', 'withdraw-alone', 'show'] as const) {
        const filled = templates[id].map((token) => (token === '<STAKE_ACCOUNT>' ? S : token));
        expect(shown, id).toContain(commandDisplayLines(filled).join('\n'));
      }
      expect(shown.join('\n')).not.toContain('<STAKE_ACCOUNT>');
      expect(shown.join('\n')).not.toContain(w.K);

      // Each case also names the Stakeward page that does it, with its full address for the paper.
      const origin = window.location.origin;
      expect(screen.getByRole('link', { name: `${origin}/rescue?address=${w.A.address}` })).toHaveAttribute(
        'href',
        `/rescue?address=${w.A.address}`,
      );
      expect(screen.getByRole('link', { name: `${origin}/withdraw/${S}` })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: `${origin}/extend/${S}` })).toBeInTheDocument();

      // Nothing to type a secret into (CLAUDE.md section 2).
      expect(document.querySelectorAll('input, textarea, select')).toHaveLength(0);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'Print opens the browser print dialog; the copy button copies the one-line command',
    async () => {
      const w = await world();
      const S = await stake(w, { unixTimestamp: T, epoch: 0n, custodian: w.K });
      const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
      const { user } = renderStakePage(w.chain, `/recovery/${S}`, []);

      await user.click(await screen.findByRole('button', { name: 'Print or save as PDF' }, WAIT));
      expect(print).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole('button', { name: 'Copy the command: move this stake to the new wallet' }));
      const rescue = recoveryCommands({ mainKeyAddress: w.A.address, url: 'devnet' }).rescue.map((token) =>
        token === '<STAKE_ACCOUNT>' ? S : token,
      );
      expect(await navigator.clipboard.readText()).toBe(commandLine(rescue));
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'staking managed by another key: named, and the withdraw steps say who stops the staking',
    async () => {
      const w = await world();
      const service = (await generateKeyPairSigner()).address;
      const S = await stake(w, { unixTimestamp: T, epoch: 0n, custodian: w.K }, service);
      renderStakePage(w.chain, `/recovery/${S}`, []);

      const facts = within(await screen.findByRole('region', { name: 'This stake account' }, WAIT));
      const row = facts.getByText('Staking managed by', { selector: 'dt' }).parentElement as HTMLElement;
      expect(within(row).getByText(service)).toBeInTheDocument();
      expect(
        screen.getByText(
          'Staking is managed by another key: that key or its service stops the staking. If that key is gone or is not yours, first move the stake to a new wallet as under "If your main key is stolen": the new wallet then manages the staking too.',
        ),
      ).toBeInTheDocument();
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'a stolen main key: extend first if there is no time, then the new wallet, the list and the rescue, numbered',
    async () => {
      const w = await world();
      const S = await stake(w, { unixTimestamp: T, epoch: 0n, custodian: w.K });
      renderStakePage(w.chain, `/recovery/${S}`, []);

      const section = await screen.findByRole('region', { name: 'If your main key is stolen' }, WAIT);
      const steps = within(within(section).getByRole('list')).getAllByRole('listitem');
      expect(steps.map((step) => step.textContent.slice(0, 40))).toEqual([
        'Use a computer you trust, not the one wh',
        'If you cannot finish soon, first extend ',
        'Make a new wallet from a new seed phrase',
        'List every stake account of the main key',
        'Move each of them to the new wallet. The',
      ]);
      // The page's tab title, which is also the name a browser suggests for the saved PDF.
      expect(document.title).toBe(`Stakeward recovery card ${S.slice(0, 3)}...${S.slice(-3)}`);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'a lock its epoch holds (set outside Stakeward): no date, no extend or remove commands, and it says why',
    async () => {
      const w = await world();
      const epoch = START_EPOCH + 30n;
      const S = await stake(w, { unixTimestamp: 0n, epoch, custodian: w.K });
      renderStakePage(w.chain, `/recovery/${S}`, []);

      const facts = within(await screen.findByRole('region', { name: 'This stake account' }, WAIT));
      expect(facts.getByText(`When epoch ${String(epoch)} begins`)).toBeInTheDocument();
      expect(facts.getByText('If you lose the second key, you wait until the lock ends to withdraw or rescue this stake.')).toBeInTheDocument();
      const extend = screen.getByRole('region', { name: 'To extend or remove the lock' });
      expect(extend).toHaveTextContent(
        `This lock also holds until epoch ${String(epoch)} begins, which was set outside Stakeward. Stakeward and the commands on this card change only the date of a lock, so they cannot shorten or remove this one.`,
      );
      expect(within(extend).queryByRole('link')).not.toBeInTheDocument();
      expect(extend.querySelectorAll('[data-slot="command-block"]')).toHaveLength(0);
      expect(screen.queryByText(/^If you cannot finish soon, first extend/)).not.toBeInTheDocument();
      expect(
        screen.getByText(/^Nobody can withdraw this stake or move it to a new wallet until the lock ends, not even you\./),
      ).toBeInTheDocument();
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'a lock no key holds (the zero key as custodian): no card, and no promise anyone can help before it ends',
    async () => {
      const w = await world();
      const S = await stake(w, { unixTimestamp: T, epoch: 0n, custodian: ZERO_ADDRESS });
      renderStakePage(w.chain, `/recovery/${S}`, []);
      expect(
        await screen.findByText(
          `This stake account is locked until ${formatUtcDate(T) ?? ''} by a lock that no key holds. Nobody can withdraw it, move it or change the lock before then, not even with Stakeward. After that, the main key alone can withdraw it: protect it again then.`,
          undefined,
          WAIT,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Protect your stake' })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Back to your accounts' })).toHaveAttribute('href', `/app?address=${w.A.address}`);
      expect(document.querySelectorAll('[data-slot="command-block"]')).toHaveLength(0);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'no card for an account without a lock: the way forward is to protect it',
    async () => {
      const w = await world();
      const open = await stake(w, { unixTimestamp: 0n, epoch: 0n, custodian: ZERO_ADDRESS });
      renderStakePage(w.chain, `/recovery/${open}`, []);
      expect(
        await screen.findByText(
          'This stake account has no lock, so anyone with its main key can withdraw it. Protect it first: then this page becomes its recovery card.',
          undefined,
          WAIT,
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Protect your stake' })).toHaveAttribute('href', `/protect?account=${open}`);
      expect(screen.getByRole('link', { name: 'Back to your accounts' })).toHaveAttribute('href', `/app?address=${w.A.address}`);
      expect(screen.queryByRole('button', { name: 'Print or save as PDF' })).not.toBeInTheDocument();
      expect(document.querySelectorAll('[data-slot="command-block"]')).toHaveLength(0);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'no card once the lock has ended (F6): said in red, with the date',
    async () => {
      const w = await world();
      const ended = await stake(w, { unixTimestamp: START_UNIX_TIMESTAMP - DAY, epoch: 0n, custodian: w.K });
      renderStakePage(w.chain, `/recovery/${ended}`, []);
      const alert = await screen.findByRole('alert', undefined, WAIT);
      expect(alert).toHaveTextContent(
        `The lock on this stake account ended on ${formatUtcDate(START_UNIX_TIMESTAMP - DAY) ?? ''}, so anyone with its main key can withdraw it now.`,
      );
      expect(document.querySelectorAll('[data-slot="command-block"]')).toHaveLength(0);
    },
    SCENARIO_TIMEOUT,
  );

  it('a broken page address says so, with a way back', async () => {
    const w = await world();
    renderStakePage(w.chain, '/recovery/not-an-address', []);
    expect(await screen.findByText('This page address does not contain a valid stake account address.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to your accounts' })).toHaveAttribute('href', '/app');
  });

  it(
    'a missing account and an address that is not a stake account each say what they are',
    async () => {
      const w = await world();
      const missing = (await generateKeyPairSigner()).address;
      const first = renderStakePage(w.chain, `/recovery/${missing}`, []);
      expect(await first.view.findByText(/^This stake account does not exist\./, undefined, WAIT)).toBeInTheDocument();

      const second = renderStakePage(w.chain, `/recovery/${w.A.address}`, []);
      expect(await second.view.findByText('This address is not a stake account.', undefined, WAIT)).toBeInTheDocument();
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'a failed read: what happened and Try again, which then shows the card',
    async () => {
      const w = await world();
      const S = await stake(w, { unixTimestamp: T, epoch: 0n, custodian: w.K });
      // Twice: StrictMode runs the page's first read twice.
      w.chain.failNext('getAccounts', new TypeError('Failed to fetch'), 2);
      const { user } = renderStakePage(w.chain, `/recovery/${S}`, []);
      expect(await screen.findByText('Could not load this stake account', undefined, WAIT)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByRole('region', { name: 'This stake account' }, WAIT)).toBeInTheDocument();
    },
    SCENARIO_TIMEOUT,
  );
});
