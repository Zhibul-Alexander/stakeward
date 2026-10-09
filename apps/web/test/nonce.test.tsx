// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import type { Address, KeyPairSigner } from '@solana/kit';
import {
  buildTransaction,
  deriveNonceAccountAddress,
  formatSol,
  inspectTransaction,
  NONCE_ACCOUNT_SEED,
  NONCE_ACCOUNT_SIZE,
  networkFeeFor,
  readNonceAccount,
  type ChainPort,
} from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { TestChain } from '@stakeward/core/test/svm';
import { createTestWalletPort, type TestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  createProtectedAccountMemory,
  createSecondKeyMemory,
  createSlotStore,
  PortsProvider,
  StaticWalletRegistry,
  type Ports,
} from '@/ports';
import { NonceCloseCard } from '@/signing/NonceCloseCard';
import { NonceGate } from '@/signing/NonceGate';
import { NonceStep } from '@/signing/NonceStep';
import { createFakeApi } from './support/fake-api.ts';
import { click, connectAndContinue, FAST_SIGNING, SCENARIO_TIMEOUT, WAIT } from './support/stake-pages.tsx';

// The link-signing account in the browser (step 7 spec 4.9): NonceGate sets it up when it is missing, NonceCloseCard
// closes it, NonceStep runs either as its own signing session. On the real System program (LiteSVM), with a test
// wallet that signs like a Wallet Standard wallet.

type World = { testChain: TestChain; chain: LiteSvmChain; A: KeyPairSigner; main: TestWalletPort; nonce: Address; deposit: bigint };

async function world(): Promise<World> {
  const testChain = await TestChain.create();
  const A = await testChain.fundedKey();
  const chain = new LiteSvmChain(testChain);
  const [main, nonce, deposit] = await Promise.all([
    createTestWalletPort({ name: 'Main Wallet', signers: [A] }),
    deriveNonceAccountAddress(A.address),
    chain.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_SIZE),
  ]);
  return { testChain, chain, A, main, nonce, deposit };
}

/** A's nonce account, made outside the page (as a finished link signing leaves it), some blocks ago. */
async function setUpNonce(w: World, options: { blocksPass: boolean } = { blocksPass: true }): Promise<void> {
  const { bytes } = buildTransaction(
    { kind: 'nonce-setup', nonceAccount: w.nonce, nonceAuthority: w.A.address, seed: NONCE_ACCOUNT_SEED, lamports: w.deposit },
    { feePayer: w.A.address, lifetime: w.testChain.blockhashLifetime() },
  );
  const result = await w.testChain.send(bytes, [w.A]);
  expect(result.ok).toBe(true);
  // Time passes: the System program refuses to close a nonce account whose stored value is the current blockhash.
  if (options.blocksPass) w.chain.expireBlockhash();
}

function renderWith(chain: ChainPort, wallets: readonly TestWalletPort[], ui: ReactNode) {
  const ports: Ports = {
    chain,
    wallets: new StaticWalletRegistry(wallets),
    slots: createSlotStore(null),
    secondKeys: createSecondKeyMemory(null),
    protectedAccounts: createProtectedAccountMemory(null),
    api: createFakeApi(chain),
  };
  const view = render(
    <StrictMode>
      <PortsProvider ports={ports}>{ui}</PortsProvider>
    </StrictMode>,
  );
  return { ...view, user: userEvent.setup() };
}

/** `chain` whose getAccounts fails while `failing.on` (an RPC outage), counting every getAccounts call. */
function flakyChain(chain: LiteSvmChain): { port: ChainPort; failing: { on: boolean }; reads: { count: number } } {
  const failing = { on: false };
  const reads = { count: 0 };
  const port = new Proxy(chain, {
    get(target, property, receiver) {
      if (property === 'getAccounts') {
        return (addresses: readonly Address[]) => {
          reads.count += 1;
          return failing.on ? Promise.reject(new Error('HTTP error (503): Service Unavailable')) : target.getAccounts(addresses);
        };
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { port, failing, reads };
}

const gate = (w: World) => (
  <NonceGate authority={w.A.address} role="main" blockedHint="Sign in this browser instead." signing={FAST_SIGNING}>
    {(account) => <p>Link-signing account ready: {account}</p>}
  </NonceGate>
);

describe('NonceGate', () => {
  it(
    'missing: explains the deposit, sets the account up with the main key alone, then renders what needs it',
    async () => {
      const w = await world();
      const before = w.testChain.balance(w.A.address);
      const { user } = renderWith(w.chain, [w.main], gate(w));

      await screen.findByRole('heading', { level: 3, name: 'Set up signing by link' }, WAIT);
      expect(screen.getByText(new RegExp(`Your Main key pays a ${formatSol(w.deposit)} deposit, returned when you close it`))).toBeInTheDocument();
      // Nothing is asked before the click (look first, UX rule 1).
      expect(w.main.requests).toHaveLength(0);

      await click(user, 'Create the link-signing account');
      await connectAndContinue(user, 'Main key', 'Main Wallet');
      await click(user, 'Sign in Main Wallet as Main key');
      await screen.findByText(`Link-signing account ready: ${w.nonce}`, undefined, WAIT);

      expect(readNonceAccount(w.testChain.account(w.nonce), w.A.address)).toMatchObject({ kind: 'ready', authority: w.A.address });
      expect(w.main.requests).toHaveLength(1);
      const [request] = w.main.requests;
      const inspected = await inspectTransaction(request?.transactions[0] ?? new Uint8Array());
      expect(inspected.ok && inspected.summary.action.kind).toBe('nonce-setup');
      expect(inspected.ok && inspected.summary.feePayer).toBe(w.A.address);
      expect(inspected.ok && inspected.summary.lifetime.kind).toBe('blockhash');
      // The deposit and one signature's fee, nothing else.
      expect(before - w.testChain.balance(w.A.address)).toBe(w.deposit + networkFeeFor(1));
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'ready: renders what needs the account at once, with no wallet request',
    async () => {
      const w = await world();
      await setUpNonce(w);
      renderWith(w.chain, [w.main], gate(w));
      await screen.findByText(`Link-signing account ready: ${w.nonce}`, undefined, WAIT);
      expect(screen.queryByRole('heading', { name: 'Set up signing by link' })).not.toBeInTheDocument();
      expect(w.main.requests).toHaveLength(0);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'address taken by another account: says so with the page hint; nothing to sign',
    async () => {
      const w = await world();
      // Anyone can block the derived address by sending SOL to it: a System account of 0 bytes.
      w.testChain.airdrop(w.nonce, 1_000_000n);
      renderWith(w.chain, [w.main], gate(w));
      await screen.findByText(/already taken by another account, so it cannot be created/, undefined, WAIT);
      expect(screen.getByText('Sign in this browser instead.')).toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.queryByText(/Link-signing account ready/)).not.toBeInTheDocument();
      expect(w.main.requests).toHaveLength(0);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'a failed read says so with Details and Try again, which reads again',
    async () => {
      const w = await world();
      await setUpNonce(w);
      const { port, failing } = flakyChain(w.chain);
      failing.on = true;
      const { user } = renderWith(port, [w.main], gate(w));
      await screen.findByText('Could not read your link-signing account', undefined, WAIT);
      expect(screen.getByText('Details')).toBeInTheDocument();
      failing.on = false;
      await click(user, 'Try again');
      await screen.findByText(`Link-signing account ready: ${w.nonce}`, undefined, WAIT);
    },
    SCENARIO_TIMEOUT,
  );
});

describe('NonceCloseCard', () => {
  it(
    'closes the account with the main key: the deposit comes back, the page is told, the card says so',
    async () => {
      const w = await world();
      await setUpNonce(w);
      const lamports = w.testChain.account(w.nonce)?.lamports ?? 0n;
      const before = w.testChain.balance(w.A.address);
      const onClosed = vi.fn();
      const { user } = renderWith(
        w.chain,
        [w.main],
        <NonceCloseCard authority={w.A.address} role="main" onClosed={onClosed} signing={FAST_SIGNING} />,
      );

      await screen.findByRole('heading', { level: 3, name: 'Close the link-signing account' }, WAIT);
      expect(screen.getByText(`Closing returns ${formatSol(lamports)} to your Main key. Any link still open stops working.`)).toBeInTheDocument();
      await click(user, 'Close it');
      await connectAndContinue(user, 'Main key', 'Main Wallet');
      await click(user, 'Sign in Main Wallet as Main key');
      await screen.findByText('Closed. The deposit went back to your Main key.', undefined, WAIT);

      expect(onClosed).toHaveBeenCalledTimes(1);
      expect(w.testChain.account(w.nonce)).toBeNull();
      expect(w.testChain.balance(w.A.address)).toBe(before + lamports - networkFeeFor(1));
      expect(w.main.requests).toHaveLength(1);
      expect(screen.queryByRole('button', { name: 'Close it' })).not.toBeInTheDocument();
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'a close in the block of the setup fails its simulation: the card says so with Details and Try again (D68)',
    async () => {
      const w = await world();
      await setUpNonce(w, { blocksPass: false });
      const { user } = renderWith(w.chain, [w.main], <NonceCloseCard authority={w.A.address} role="main" signing={FAST_SIGNING} />);
      await click(user, 'Close it');
      // The simulation runs before any wallet is asked.
      await screen.findByText('Did not go through', undefined, WAIT);
      expect(screen.getByText('Details')).toBeInTheDocument();
      expect(w.main.requests).toHaveLength(0);

      w.chain.expireBlockhash();
      await click(user, 'Try again');
      await connectAndContinue(user, 'Main key', 'Main Wallet');
      await click(user, 'Sign in Main Wallet as Main key');
      await screen.findByText('Closed. The deposit went back to your Main key.', undefined, WAIT);
      expect(w.testChain.account(w.nonce)).toBeNull();
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'cancel-link: the same close, put as cancelling the link, under the link card (h4)',
    async () => {
      const w = await world();
      await setUpNonce(w);
      renderWith(w.chain, [w.main], <NonceCloseCard authority={w.A.address} role="main" variant="cancel-link" signing={FAST_SIGNING} />);
      // Opened from the link card's "Cancel the link": a question, the deposit that comes back, then the confirmation.
      const heading = await screen.findByRole('heading', { level: 4, name: 'Cancel the link?' }, WAIT);
      expect(screen.getByText(/so this link stops working\. Its deposit of .+ comes back to your Main key\./)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Yes, cancel the link' })).toBeInTheDocument();
      // No frame of its own: the link card's inset holds it.
      expect(heading.closest('[data-slot="nonce-step"]')).not.toHaveClass('border');
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'cancel-link: says when the account cannot be read (Try again reads it again) and when it is already closed',
    async () => {
      const w = await world();
      const { port, failing } = flakyChain(w.chain);
      failing.on = true;
      const { user } = renderWith(port, [w.main], <NonceCloseCard authority={w.A.address} role="main" variant="cancel-link" signing={FAST_SIGNING} />);
      // The user asked to cancel: the inset is never empty while it reads, fails or finds nothing to close.
      await screen.findByText('Could not read your link-signing account', undefined, WAIT);
      failing.on = false;
      await click(user, 'Try again');
      await screen.findByText('Your link-signing account is already closed, so this link can no longer be sent.', undefined, WAIT);
      expect(screen.queryByRole('button', { name: 'Yes, cancel the link' })).not.toBeInTheDocument();
      expect(w.main.requests).toHaveLength(0);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'no account: shows nothing (closing is never required)',
    async () => {
      const w = await world();
      const { port, reads } = flakyChain(w.chain);
      const { container } = renderWith(port, [w.main], <NonceCloseCard authority={w.A.address} role="main" signing={FAST_SIGNING} />);
      await waitFor(() => {
        expect(reads.count).toBeGreaterThan(0);
      });
      // Let the read settle, then nothing is there.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(container).toBeEmptyDOMElement();
    },
    SCENARIO_TIMEOUT,
  );
});

describe('NonceStep', () => {
  it(
    'Back from its signing returns to the card, nothing asked; a refused run comes back with the reason and Try again',
    async () => {
      const w = await world();
      const onDone = vi.fn();
      const { user } = renderWith(
        w.chain,
        [w.main],
        <NonceStep
          authority={w.A.address}
          nonceAccount={w.nonce}
          role="main"
          mode="setup"
          amount={w.deposit}
          onDone={onDone}
          signing={FAST_SIGNING}
        />,
      );

      await click(user, 'Create the link-signing account');
      await screen.findByText('Connect your Main key to continue: it must sign these transactions.', undefined, WAIT);
      await click(user, 'Back');
      const heading = await screen.findByRole('heading', { name: 'Set up signing by link' }, WAIT);
      expect(heading).toHaveFocus();
      expect(screen.getByRole('button', { name: 'Create the link-signing account' })).toBeInTheDocument();

      // Someone takes the address before the setup: the plan refuses and the card says why.
      w.testChain.airdrop(w.nonce, 1_000_000n);
      await click(user, 'Create the link-signing account');
      await screen.findByText(/already taken by another account, so it cannot be created/, undefined, WAIT);
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
      expect(onDone).not.toHaveBeenCalled();
      expect(w.main.requests).toHaveLength(0);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'a run that finds the account already set up (it landed before) is done with no request',
    async () => {
      const w = await world();
      await setUpNonce(w);
      const onDone = vi.fn();
      const { user } = renderWith(
        w.chain,
        [w.main],
        <NonceStep
          authority={w.A.address}
          nonceAccount={w.nonce}
          role="main"
          mode="setup"
          amount={w.deposit}
          onDone={onDone}
          signing={FAST_SIGNING}
        />,
      );
      await click(user, 'Create the link-signing account');
      await waitFor(() => {
        expect(onDone).toHaveBeenCalledTimes(1);
      }, WAIT);
      expect(w.main.requests).toHaveLength(0);
    },
    SCENARIO_TIMEOUT,
  );
});
