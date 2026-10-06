// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit';
import { buildTransaction, cliUrl, commandLine, formatUtcDateTime, recoveryCommands, type TransactionAction } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { START_EPOCH, START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { createTestWalletPort, type TestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Route, Router, Switch } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import en from '@/i18n/en.json';
import { RecoveryPage } from '@/pages/RecoveryPage';
import { PortsProvider } from '@/ports';
import { CountingChain } from './support/counting-chain.ts';
import { SCENARIO_TIMEOUT, testPorts, WAIT } from './support/stake-pages.tsx';

// /recovery/:account (step 8 spec 5, DECISIONS.md D74) on the real stake program: the main key A locked S1 and S2 with
// the second key K (SetLockupChecked, as the protect wizard does); S3 has no lock; another second key K' locks S4. The
// card is read from the network only: no wallet, nothing written.

const DAY = 86_400n;
const T = START_UNIX_TIMESTAMP + 180n * DAY;

type World = {
  testChain: TestChain;
  lite: LiteSvmChain;
  A: KeyPairSigner;
  K: KeyPairSigner;
  S1: Address;
  S2: Address;
  S3: Address;
  S4: Address;
  epochLocked: Address;
};

let w: World;

async function protect(world: Omit<World, 'S1' | 'S2' | 'S3' | 'S4' | 'epochLocked'>, stakeAccount: Address, second: KeyPairSigner) {
  const action: TransactionAction = { kind: 'protect', stakeAccount, mainKey: world.A.address, secondKey: second.address, lockUntil: T };
  const lifetime = { kind: 'blockhash', ...(await world.lite.getLatestBlockhash()) } as const;
  const result = await world.testChain.send(buildTransaction(action, { feePayer: world.A.address, lifetime }).bytes, [world.A, second]);
  if (!result.ok) throw new Error(`protect failed: ${JSON.stringify(result.error)}`);
}

beforeAll(async () => {
  const testChain = await TestChain.create();
  const lite = new LiteSvmChain(testChain);
  const [A, K, K2] = await Promise.all([testChain.fundedKey(), generateKeyPairSigner(), generateKeyPairSigner()]);
  const base = { testChain, lite, A, K };
  const own = { staker: A.address, withdrawer: A.address };
  // One at a time: only the latest LiteSVM blockhash is valid.
  const S1 = await testChain.createStakeAccount(own);
  const S2 = await testChain.createStakeAccount(own);
  const S3 = await testChain.createStakeAccount(own);
  const S4 = await testChain.createStakeAccount(own);
  await protect(base, S1, K);
  await protect(base, S2, K);
  await protect(base, S4, K2);
  // Another main key's stake, locked by an epoch (set at Initialize; Stakeward never sets such a lock).
  const other = (await generateKeyPairSigner()).address;
  const epochLocked = await testChain.createStakeAccount({
    staker: other,
    withdrawer: other,
    lockup: { unixTimestamp: 0n, epoch: START_EPOCH + 10n, custodian: K.address },
  });
  w = { ...base, S1, S2, S3, S4, epochLocked };
}, SCENARIO_TIMEOUT);

afterEach(() => {
  vi.restoreAllMocks();
});

function renderRecovery(path: string, wallets: readonly TestWalletPort[] = []) {
  const chain = new CountingChain(w.lite);
  const ports = testPorts(chain, wallets);
  const location = memoryLocation({ path, record: true });
  const user = userEvent.setup();
  render(
    <StrictMode>
      <Router hook={location.hook} searchHook={location.searchHook}>
        <PortsProvider ports={ports}>
          <Switch>
            <Route path="/recovery/:account">
              <RecoveryPage />
            </Route>
          </Switch>
        </PortsProvider>
      </Router>
    </StrictMode>,
  );
  return { chain, ports, user };
}

/** What bash and zsh read from a command block: line continuations removed, the indentation collapsed. */
function shellLine(group: HTMLElement): string {
  return (group.querySelector('pre')?.textContent ?? '')
    .split('\n')
    .map((line) => line.replace(/ \\$/, '').trim())
    .join(' ');
}

const block = (label: string) => screen.getByRole('group', { name: label });

/** Elements whose own text holds `text`. */
function textHolders(text: string): Element[] {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const holders: Element[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.textContent?.includes(text) === true && node.parentElement !== null) holders.push(node.parentElement);
  }
  return holders;
}

const follows = (first: Element, second: Element) => (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe('/recovery/:account on LiteSvmChain', () => {
  it(
    'R1: the card of the pair of keys: both keys, every account they lock, the command line steps; read only',
    async () => {
      const setItem = vi.spyOn(Storage.prototype, 'setItem');
      const wallet = await createTestWalletPort({ name: 'Main Wallet', signers: [w.A] });
      const { chain, user } = renderRecovery(`/recovery/${w.S2}`, [wallet]);

      expect(screen.getByRole('heading', { level: 1, name: 'Stakeward recovery card' })).toBeInTheDocument();
      const keys = await screen.findByRole('heading', { level: 2, name: 'Keys' }, WAIT);
      const keysSection = keys.closest('section') as HTMLElement;
      expect(within(keysSection).getByText(w.A.address)).toBeInTheDocument();
      expect(within(keysSection).getByText(w.K.address)).toBeInTheDocument();
      expect(within(keysSection).getByText('Main key')).toBeInTheDocument();
      expect(within(keysSection).getByText('Second key')).toBeInTheDocument();

      // Check first: before the keys, in the DOM order a reader and a printer follow (spec L6).
      const verify = screen.getByText('Check the second key first');
      expect(follows(verify, keys)).toBe(true);
      // The card cannot know whose the second key is (D35). It links the FAQ answer about such a lock, by its question.
      expect(screen.queryByText('Protected')).toBeNull();
      const verifyNote = verify.closest('[data-slot="recovery-verify"]') as HTMLElement;
      expect(within(verifyNote).getByRole('link', { name: `Why a stake account says ${en.status.lockedByOther}` })).toHaveAttribute(
        'href',
        '/#faq-locked-by-other',
      );

      // The route first, then the other account of this pair; neither the open one nor another second key's.
      const rows = [...document.querySelectorAll<HTMLElement>('[data-slot="recovery-account"]')];
      expect(rows.map((row) => within(row).getAllByText(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)[0]?.textContent)).toEqual([w.S2, w.S1]);
      for (const row of rows) expect(row).toHaveTextContent(`Locked until ${formatUtcDateTime(T) ?? ''}`);
      expect(formatUtcDateTime(T)).toMatch(/, 00:00 UTC$/);
      expect(screen.queryAllByText(w.S3)).toEqual([]);
      expect(screen.queryAllByText(w.S4)).toEqual([]);
      expect(screen.getByText(/^This main key has 2 more stake accounts that this card does not cover/)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'See all stake accounts of this main key' })).toHaveAttribute('href', `/app?address=${w.A.address}`);

      // Commands: placeholders for every key that signs; the withdraw goes to <MAIN_KEY>, never to a printed address.
      const commands = recoveryCommands({ mainKeyAddress: w.A.address, url: cliUrl('devnet') });
      const withdraw = shellLine(block('Withdraw with both keys'));
      expect(withdraw).toContain('withdraw-stake <STAKE_ACCOUNT> <MAIN_KEY> ALL');
      expect(withdraw).toContain('--url devnet');
      expect(withdraw).toBe(commandLine(commands.withdraw));
      const rescue = shellLine(block('Move a stake account to the new wallet'));
      expect(rescue).toContain('stake-authorize-checked');
      expect(rescue).toContain('--fee-payer <NEW_WALLET>');
      expect(shellLine(block('Hand the lock to a new second key'))).toContain('--fee-payer <NEW_SECOND_KEY>');
      expect(shellLine(block('List the stake accounts of the main key'))).toBe(`solana stakes --withdraw-authority ${w.A.address} --url devnet`);
      // A's address: in Keys, in the find command (read only), and in the printed address of a link to this main key's
      // pages; no other command holds it.
      const findBlock = block('List the stake accounts of the main key');
      for (const holder of textHolders(w.A.address)) {
        expect(keysSection.contains(holder) || findBlock.contains(holder) || holder.closest('[data-slot="printed-link"]') !== null).toBe(true);
      }
      const blocksWithA = [...document.querySelectorAll('[data-slot="command-block"]')].filter((group) => group.textContent.includes(w.A.address));
      expect(blocksWithA).toEqual([findBlock]);

      // What to do, read on paper with no one to ask (CLAUDE.md section 9).
      const caseOf = (title: string) => screen.getByRole('heading', { level: 3, name: title }).closest('section') as HTMLElement;
      const stolen = caseOf('Your main key is stolen, or someone saw its seed phrase');
      // The thief can split while the stake accounts move one at a time: list them again after the moves. The card
      // printed again names the new wallet, so this copy is the only one that lists the stolen key's accounts.
      const listAgain = within(stolen).getByText(/run the command that lists them again/);
      expect(follows(block('Move a stake account to the new wallet'), listAgain)).toBe(true);
      expect(listAgain.textContent).toMatch(/lists them again.*until it lists none.*open this card again.*Keep this copy/s);
      // Every new key comes from a new seed phrase, never from a Ledger that holds a key of this card.
      for (const part of [stolen, caseOf('Your second key is stolen, or someone saw its seed phrase')]) {
        expect(part).toHaveTextContent('a new Ledger, a spare Ledger reset with a new seed phrase, or a keypair file made with solana-keygen new');
        expect(part).toHaveTextContent('Never use the Ledger that holds your main key or your second key, not even another account on it');
      }
      expect(caseOf('You lost the second key')).toHaveTextContent('a new second key made from a new seed phrase');
      const limits = screen.getByRole('heading', { level: 2, name: 'What no one can undo' }).closest('section') as HTMLElement;
      expect(within(limits).getByText(/^Two keys from one seed phrase protect nothing/)).toBeInTheDocument();
      // The command line steps say what was run (keypair files) and what was not (a real Ledger), as the README does.
      expect(screen.getByText(/^Tested with Solana CLI 4\.3\.0 on a local Solana test validator, with keypair files\.$/)).toBeInTheDocument();
      expect(screen.getByText(/^To find which Ledger key is yours.* These commands have not been tried with a real Ledger yet\.$/)).toBeInTheDocument();

      // Risk before action: the unlock warning comes before the remove-lock command.
      const unlockRisk = document.querySelector('[data-risk="unlock-opens-window"]') as HTMLElement;
      expect(follows(unlockRisk, block('Remove the lock'))).toBe(true);

      // Copy gives the one-line command; Print opens the print dialog.
      const write = vi.spyOn(navigator.clipboard, 'writeText');
      await user.click(screen.getByRole('button', { name: 'Copy the command: Withdraw with both keys' }));
      expect(write).toHaveBeenCalledWith(commandLine(commands.withdraw));
      const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
      await user.click(screen.getByRole('button', { name: 'Print this card' }));
      expect(print).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('link', { name: 'Back to your accounts' })).toHaveAttribute('href', `/app?address=${w.A.address}`);

      // Read only: the account and the clock, then the main key's search (read again). No wallet, no storage.
      expect(new Set(chain.calls.map((call) => call.method))).toEqual(new Set(['getAccounts', 'getClock', 'findStakeAccounts']));
      for (const call of chain.calls.filter((c) => c.method === 'findStakeAccounts')) expect(call.args).toEqual([{ withdrawer: w.A.address }]);
      expect(wallet.accounts).toEqual([]);
      expect(wallet.requests).toEqual([]);
      expect(setItem).not.toHaveBeenCalled();
    },
    SCENARIO_TIMEOUT,
  );

  it('R2: an address that is not a stake account address', () => {
    renderRecovery('/recovery/garbage');
    expect(screen.getByText('This page address does not contain a valid stake account address.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to your accounts' })).toHaveAttribute('href', '/app');
    expect(screen.queryByRole('button', { name: 'Print this card' })).toBeNull();
  });

  it(
    'R3: no account, not a stake account, no lock, an epoch lock: each says why, with a way forward',
    async () => {
      const empty = (await generateKeyPairSigner()).address;
      const first = renderRecovery(`/recovery/${empty}`);
      expect(await screen.findByRole('heading', { name: 'No account exists at this address' }, WAIT)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: "Look up a wallet's stake accounts" })).toHaveAttribute('href', '/app');
      expect(first.chain.count('findStakeAccounts')).toBe(0);
      cleanup();

      renderRecovery(`/recovery/${w.A.address}`);
      expect(await screen.findByText('This address is not a stake account.', undefined, WAIT)).toBeInTheDocument();
      cleanup();

      renderRecovery(`/recovery/${w.S3}`);
      expect(await screen.findByText('This stake account is not protected', undefined, WAIT)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Protect it' })).toHaveAttribute('href', `/protect?account=${w.S3}`);
      cleanup();

      renderRecovery(`/recovery/${w.epochLocked}`);
      expect(await screen.findByText('Stakeward cannot write a card for this lock', undefined, WAIT)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Print this card' })).toBeNull();
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'R4: a failed read shows no partial card; Try again reads again',
    async () => {
      w.lite.failNext('getClock', new TypeError('Failed to fetch'), 2);
      const { user } = renderRecovery(`/recovery/${w.S1}`);
      expect(await screen.findByText('Could not load the recovery card', undefined, WAIT)).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Keys' })).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByRole('heading', { level: 2, name: 'Keys' }, WAIT)).toBeInTheDocument();
      // This route first: S1, then S2.
      const rows = [...document.querySelectorAll('[data-slot="recovery-account"]')];
      expect(rows[0]).toHaveTextContent(w.S1);
      expect(rows[1]).toHaveTextContent(w.S2);
    },
    SCENARIO_TIMEOUT,
  );
});
