// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit';
import {
  buildTransaction,
  cliUrl,
  commandLine,
  formatUtcDateTime,
  recoveryCommands,
  shortAddress,
  type TransactionAction,
} from '@stakeward/core';
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
        '/learn/faq#faq-locked-by-other',
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
      const listAgain = within(stolen).getByText(/^When all are moved, list them again/);
      expect(follows(block('Move a stake account to the new wallet'), listAgain)).toBe(true);
      expect(listAgain.textContent).toMatch(/list them again.*until the list is empty.*Open this card again.*Keep this copy/s);
      // Every new key comes from a new seed phrase, never from a Ledger that holds a key of this card. The card says
      // it once, in a note before the cases, and both stolen-key cases send the reader to it before a new key is made.
      const newKey = document.querySelector('[data-slot="recovery-new-key"]') as HTMLElement;
      expect(newKey).toHaveTextContent('A new key means a new seed phrase');
      expect(newKey).toHaveTextContent('a new Ledger, a spare Ledger reset with a new seed phrase, or a keypair file from solana-keygen new');
      expect(newKey).toHaveTextContent('Never use the Ledger that holds your main key or your second key, not even another account on it');
      for (const part of [stolen, caseOf('Your second key is stolen, or someone saw its seed phrase')]) {
        expect(follows(newKey, part)).toBe(true);
        expect(within(part).getByRole('link', { name: /A new key means a new seed phrase/ })).toHaveAttribute('href', `#${newKey.id}`);
      }
      // Lost the second key: risk before the action (UX rule 6). Once the lock ends the main key alone withdraws, and so
      // could a thief with it; both ways out wait for the lock's end. The command to withdraw alone lives in "You want
      // to withdraw", which this case links to: the card shows it once.
      const lostSecond = caseOf('You lost the second key');
      expect(lostSecond).toHaveTextContent('a new second key from a new seed phrase');
      expect(lostSecond).toHaveTextContent('After that, whoever holds the main key can withdraw alone: keep it safe.');
      expect(within(lostSecond).getByText(/^Or, once the lock ends, stop staking and withdraw with the main key alone\./)).toBeInTheDocument();
      const withdrawCase = caseOf('You want to withdraw');
      expect(within(lostSecond).getByRole('link', { name: 'See “You want to withdraw”.' })).toHaveAttribute('href', `#${withdrawCase.id}`);
      expect(screen.getAllByRole('group', { name: 'Withdraw with the main key alone' })).toHaveLength(1);
      expect(withdrawCase).toContainElement(block('Withdraw with the main key alone'));
      // Each case says what to do in Stakeward before the command line.
      expect(follows(within(stolen).getByRole('link', { name: 'Rescue in Stakeward' }), block('List the stake accounts of the main key'))).toBe(true);
      expect(follows(within(caseOf('The lock is about to end')).getByRole('link', { name: 'Extend in Stakeward' }), block('Extend the lock'))).toBe(true);
      // A date inside a sentence stays on one line (no-break spaces): a narrow screen must not split "before 29" /
      // "October 2026, 14:30 UTC".
      const dateOnOneLine = (formatUtcDateTime(T) ?? '').replaceAll(' ', '\u00a0');
      expect(within(stolen).getByText(/^Without the second key, the thief cannot withdraw/).textContent).toContain(` ${dateOnOneLine}.`);
      expect(within(caseOf('The lock is about to end')).getByText(/^Extend it with the second key before/).textContent).toContain(
        ` ${dateOnOneLine};`,
      );
      expect(follows(within(caseOf('You want to withdraw')).getByRole('link', { name: 'Withdraw in Stakeward' }), block('Stop staking'))).toBe(
        true,
      );
      // An index of the six cases comes before them, each entry an anchor link to its case, named by its whole title:
      // someone whose seed phrase was seen may not call the key stolen.
      const index = screen.getByRole('navigation', { name: 'The cases on this card' });
      const entries = within(index).getAllByRole('link');
      const caseHeadings = [...document.querySelectorAll('[data-slot="recovery-card"] h3')];
      expect(entries).toHaveLength(6);
      expect(caseHeadings).toHaveLength(6);
      entries.forEach((entry, position) => {
        const target = document.getElementById((entry.getAttribute('href') ?? '').slice(1));
        expect(target?.querySelector('h3')).toBe(caseHeadings[position]);
        expect(entry.textContent).toBe(caseHeadings[position]?.textContent);
        expect(follows(index, target as HTMLElement)).toBe(true);
      });
      // Stopping an Activating stake makes it Inactive at once; only an Active one waits for the epoch's end (as the
      // Deactivate summary says, 4e).
      expect(within(caseOf('You want to withdraw')).getByText(/^Or, without Stakeward: stop staking first/)).toHaveTextContent(
        "Or, without Stakeward: stop staking first if the stake is Active or Activating. Activating stops at once, Active at the epoch's end, within about 2 days. The second command shows the time left:",
      );
      const limits = screen.getByRole('heading', { level: 2, name: 'What no one can undo' }).closest('section') as HTMLElement;
      expect(within(limits).getByText(/^Two keys from one seed phrase protect nothing/)).toBeInTheDocument();
      // The command line steps say what was run (keypair files) and what was not (a real Ledger), as the README does.
      expect(screen.getByText(/^Tested with Solana CLI 4\.3\.0 on a local Solana test validator, with keypair files\.$/)).toBeInTheDocument();
      expect(screen.getByText(/^To find your Ledger key, open its Solana app and run this\./)).toBeInTheDocument();
      expect(screen.getByText('Not tested with a real Ledger yet.')).toBeInTheDocument();
      // Before a command: every key that signs on this computer, and what replaces each placeholder.
      const beforeCli = screen.getByRole('heading', { level: 2, name: 'Before you run a command' }).closest('section') as HTMLElement;
      expect(beforeCli).toHaveTextContent(
        'Every key that signs must be on this computer: a keypair file or a Ledger. A key only in a browser or phone wallet cannot sign here.',
      );
      const meaning = (placeholder: string) => within(beforeCli).getByText(placeholder, { selector: 'code' }).closest('dt')?.nextElementSibling;
      expect(meaning('<STAKE_ACCOUNT>')).toHaveTextContent(/^an address from the list above/);
      for (const key of ['<MAIN_KEY>', '<SECOND_KEY>', '<NEW_WALLET>', '<NEW_SECOND_KEY>']) {
        expect(meaning(key)).toHaveTextContent('the keypair file path, or "usb://ledger?key=0" with the quotes');
      }

      // Risk before action: the unlock warning comes before the remove-lock command. Removing the lock is an
      // alternative, not the next numbered step after a withdraw with both keys.
      const unlockRisk = document.querySelector('[data-risk="unlock-opens-window"]') as HTMLElement;
      expect(follows(unlockRisk, block('Remove the lock'))).toBe(true);
      expect(block('Remove the lock').closest('ol')).toBeNull();
      expect(within(withdrawCase).getByText(/^Or, if the keys are not on one computer:/)).toBeInTheDocument();
      // Alternatives are not numbered as a sequence: in "Your main key is stolen" Rescue and its command line form one
      // step, followed by listing again; "The lock is about to end" has no numbered steps.
      const moveStep = within(stolen).getByRole('link', { name: 'Rescue in Stakeward' }).closest('li') as HTMLElement;
      expect(moveStep).toContainElement(block('List the stake accounts of the main key'));
      expect(moveStep).toContainElement(block('Move a stake account to the new wallet'));
      expect(moveStep.nextElementSibling).toBe(listAgain);
      expect(caseOf('The lock is about to end').querySelector('ol')).toBeNull();

      // The seed-phrase warning stands before the first command of the card (and before the index), once, with the
      // promise that Stakeward never asks for one.
      const noSeed = document.querySelector('[data-slot="recovery-no-seed"]') as HTMLElement;
      expect(noSeed).toHaveTextContent('Never type a seed phrase into a command or a website. Stakeward never asks for your seed phrase.');
      expect(follows(noSeed, document.querySelector('[data-slot="recovery-card"] [data-slot="command-block"]') as HTMLElement)).toBe(true);
      expect(follows(noSeed, index)).toBe(true);
      expect(textHolders('Stakeward never asks for your seed phrase.')).toHaveLength(1);
      // A command-line option and its placeholder never break across lines: typed apart, they fail.
      const custodian = document.querySelector('[data-cli-error="custodian"] dd') as HTMLElement;
      expect(within(custodian).getByText('--custodian <SECOND_KEY>')).toHaveClass('whitespace-nowrap');
      expect(within(beforeCli).getByText('--fee-payer')).toHaveClass('whitespace-nowrap');
      // The lock ends by the cluster's clock, which runs behind: wait a few minutes past the end.
      expect(document.querySelector('[data-cli-error="lockup"] dd')).toHaveTextContent("wait a few minutes past the lock's end (UTC)");
      // On paper, what leads into a command stays on its sheet (break-after: avoid, as the headings, D77): a command
      // torn from the sentence that says when to run it is worse than a page break before both.
      for (const group of document.querySelectorAll('[data-slot="recovery-card"] [data-slot="command-block"]')) {
        const lead = group.previousElementSibling;
        if (lead === null || lead.getAttribute('data-slot') === 'command-block') continue;
        expect(lead, group.getAttribute('aria-label') ?? '').toHaveClass('print:break-after-avoid');
      }

      // Copy gives the one-line command; Print opens the print dialog.
      const write = vi.spyOn(navigator.clipboard, 'writeText');
      await user.click(screen.getByRole('button', { name: 'Copy the command: Withdraw with both keys' }));
      expect(write).toHaveBeenCalledWith(commandLine(commands.withdraw));
      const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
      await user.click(screen.getByRole('button', { name: 'Print this card' }));
      expect(print).toHaveBeenCalledTimes(1);
      // Back to the main key's accounts stands above the title, as PageHeader places it, so Print is the header's one
      // control and ends where the card ends.
      const back = screen.getByRole('link', { name: 'Back to your accounts' });
      expect(back).toHaveAttribute('href', `/app?address=${w.A.address}`);
      expect(follows(back, screen.getByRole('heading', { level: 1 }))).toBe(true);
      // The page's one filled button is Print; Back is a ghost link.
      expect([...document.querySelectorAll('[data-slot="button"][data-variant="primary"], [data-slot="button"][data-variant="danger"]')].map((b) => b.textContent)).toEqual([
        'Print this card',
      ]);
      // Under the title, and printed with it: when the card was read and, on devnet, that it holds no real SOL.
      const meta = document.querySelector('[data-slot="page-header-meta"]') as HTMLElement;
      expect(meta).toHaveTextContent(/^Read from the network on .+, \d\d:\d\d UTC\./);
      expect(within(meta).getByText('Devnet')).toBeInTheDocument();
      expect(within(meta).getByText('Test network: these stake accounts hold no real SOL.')).toBeInTheDocument();

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
    'R5: the tab title names the stake account, so a card saved as PDF is named after it; leaving the page restores it',
    async () => {
      const before = document.title;
      renderRecovery(`/recovery/${w.S1}`);
      await screen.findByRole('heading', { level: 2, name: 'Keys' }, WAIT);
      expect(document.title).toBe(`Stakeward recovery card ${shortAddress(w.S1)}`);
      cleanup();
      expect(document.title).toBe(before);
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
      // A way out besides Try again, and no filled button: there is nothing to print.
      expect(screen.getByRole('link', { name: 'Back to your accounts' })).toHaveAttribute('href', '/app');
      expect(document.querySelector('[data-slot="button"][data-variant="primary"]')).toBeNull();
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
