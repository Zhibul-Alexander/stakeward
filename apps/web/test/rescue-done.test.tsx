import { generateKeyPairSigner, type Address } from '@solana/kit';
import { ZERO_ADDRESS, type ChainPort, type Lockup, type StakeAccount } from '@stakeward/core';
import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import {
  createProtectedAccountMemory,
  createSecondKeyMemory,
  createSlotStore,
  PortsProvider,
  StaticWalletRegistry,
  type Ports,
} from '@/ports';
import { DoneStep } from '@/pages/rescue/DoneStep';
import type { JobView } from '@/signing/machine';
import { createFakeApi } from './support/fake-api.ts';

// The rescue's Done screen (F4 step 6) after the moves: what each moved account's lock now means, the way to protect
// the ones left without a lock, and a new recovery card, because one printed before names the old main key.

const CLOCK = { unixTimestamp: 1_790_812_800n, epoch: 850n };
const T = 1_807_488_000n; // 12 April 2027, after CLOCK
const ENDED = 1_780_000_000n; // before CLOCK

/** No link-signing account for the new wallet: NonceCloseCard shows nothing. */
const chain = {
  getAccounts: (addresses: readonly Address[]) => Promise.resolve({ slot: 1n, accounts: addresses.map(() => null) }),
  getMinimumBalanceForRentExemption: () => Promise.resolve(1_447_680n),
} as unknown as ChainPort;

let NEW: Address;
let SECOND: Address;
let OTHER: Address;
const ids: Address[] = [];

beforeAll(async () => {
  const keys = await Promise.all(Array.from({ length: 11 }, () => generateKeyPairSigner()));
  [NEW, SECOND, OTHER] = keys.slice(0, 3).map((key) => key.address) as [Address, Address, Address];
  ids.push(...keys.slice(3).map((key) => key.address));
});

/** A moved account as the chain shows it now: the new wallet holds both roles, the lock is whatever it was. */
function moved(id: Address, lockup: Lockup): JobView {
  const after: StakeAccount = {
    address: id,
    lamports: 2_000_000_000n,
    kind: 'initialized',
    rentExemptReserve: 2_282_880n,
    staker: NEW,
    withdrawer: NEW,
    lockup,
    delegation: null,
  };
  return { id, state: { kind: 'done', after }, before: null, action: null, lifetime: null, signature: null, bytes: null };
}

const lockedBySecond = (): Lockup => ({ unixTimestamp: T, epoch: 0n, custodian: SECOND });
const noLock = (): Lockup => ({ unixTimestamp: 0n, epoch: 0n, custodian: ZERO_ADDRESS });
const ended = (): Lockup => ({ unixTimestamp: ENDED, epoch: 0n, custodian: SECOND });

function show(outcomes: readonly JobView[]) {
  const ports: Ports = {
    chain,
    wallets: new StaticWalletRegistry([]),
    slots: createSlotStore(null),
    secondKeys: createSecondKeyMemory(null),
    protectedAccounts: createProtectedAccountMemory(null),
    api: createFakeApi(),
  };
  const location = memoryLocation({ path: '/rescue' });
  render(
    <Router hook={location.hook} searchHook={location.searchHook}>
      <PortsProvider ports={ports}>
        <DoneStep
          headingRef={null}
          outcomes={outcomes}
          clock={CLOCK}
          newWallet={NEW}
          secondKey={SECOND}
          checking={false}
          checkFailed={false}
          actions={{ retry: vi.fn(), checkAgain: vi.fn(), lookAgain: vi.fn() }}
        />
      </PortsProvider>
    </Router>,
  );
}

const protectHref = (accounts: readonly Address[]) => `/protect?${new URLSearchParams(accounts.map((a) => ['account', a])).toString()}`;

describe('rescue Done: the locks the moves kept, and what is left without one', () => {
  it('counts the accounts that had no lock apart from those whose lock had ended, and links Protect for them all', () => {
    const [L1, N1, E1, L2, N2] = ids as [Address, Address, Address, Address, Address];
    show([moved(L1, lockedBySecond()), moved(N1, noLock()), moved(E1, ended()), moved(L2, lockedBySecond()), moved(N2, noLock())]);

    expect(screen.getByText('Each lock stays as it was, and your second key still holds it.')).toBeInTheDocument();
    expect(screen.getByText('2 stake accounts had no lock, and they still have none.')).toBeInTheDocument();
    expect(screen.getByText('The lock of 1 stake account had already ended, so it is not protected now.')).toBeInTheDocument();
    expect(screen.queryByText(/had no lock still has none/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Protect 3 stake accounts with your new wallet as the main key' })).toHaveAttribute(
      'href',
      protectHref([N1, E1, N2]),
    );
  });

  it('says it in the singular for one account, and the plural of an ended lock for several', () => {
    const [N1, E1, E2] = ids as [Address, Address, Address];
    show([moved(N1, noLock()), moved(E1, ended()), moved(E2, ended())]);
    expect(screen.getByText('1 stake account had no lock, and it still has none.')).toBeInTheDocument();
    expect(screen.getByText('The locks of 2 stake accounts had already ended, so they are not protected now.')).toBeInTheDocument();
    // Nothing here is locked: no word of a lock the second key holds, and no recovery card (none can be written).
    expect(screen.queryByText(/your second key still holds it/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Print a new recovery card' })).not.toBeInTheDocument();
  });

  it('one account without a lock: one Protect link for it', () => {
    const [N1] = ids as [Address];
    show([moved(N1, noLock())]);
    expect(screen.getByText('1 stake account had no lock, and it still has none.')).toBeInTheDocument();
    expect(screen.queryByText(/had already ended/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Protect 1 stake account with your new wallet as the main key' })).toHaveAttribute(
      'href',
      protectHref([N1]),
    );
  });

  it('a lock in force that another key holds is not called the second key’s, and gets no card here', () => {
    const [X1] = ids as [Address];
    show([moved(X1, { unixTimestamp: T, epoch: 0n, custodian: OTHER })]);
    expect(screen.queryByText(/your second key still holds it/)).not.toBeInTheDocument();
    expect(screen.queryByText(/had no lock/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Protect / })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Print a new recovery card' })).not.toBeInTheDocument();
  });
});

describe('rescue Done: a new recovery card', () => {
  it('says the old card names the old main key and opens the new card of the locked accounts', () => {
    const [N1, L1, L2] = ids as [Address, Address, Address];
    show([moved(N1, noLock()), moved(L1, lockedBySecond()), moved(L2, lockedBySecond())]);
    const card = screen.getByRole('heading', { name: 'Print a new recovery card' }).closest('[data-slot="next-step"]') as HTMLElement;
    expect(card).toHaveTextContent(
      'Your old card names the old main key, so its commands no longer work. Print the new one and keep it with your second key. It holds no secrets.',
    );
    // One card covers every stake account of the pair (D74): the first locked one opens it.
    expect(screen.getByRole('link', { name: 'Open the new recovery card' })).toHaveAttribute('href', `/recovery/${L1}`);
  });

  it('a lock an epoch holds keeps its words, but no card can be written for it', () => {
    const [P1] = ids as [Address];
    show([moved(P1, { unixTimestamp: 0n, epoch: 900n, custodian: SECOND })]);
    expect(screen.getByText('Each lock stays as it was, and your second key still holds it.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Print a new recovery card' })).not.toBeInTheDocument();
  });
});

describe('rescue Done: the answer, then one way on (DECISIONS.md D109)', () => {
  it('names the new owner in full once, lists the next steps, and fills only "View your stake"', () => {
    const [L1, N1] = ids as [Address, Address];
    show([moved(L1, lockedBySecond()), moved(N1, noLock())]);
    expect(screen.getByRole('heading', { level: 2, name: '2 stake accounts are safe' })).toBeInTheDocument();
    expect(screen.getAllByText(NEW)).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 3, name: 'Next steps' })).toBeInTheDocument();
    expect(
      screen.getByText('From now on, use your new wallet. Stop using the old main key: anything sent to it may be taken.'),
    ).toBeInTheDocument();
    const filled = document.querySelectorAll('[data-slot="button"][data-variant="primary"], [data-slot="button"][data-variant="danger"]');
    expect([...filled].map((button) => button.textContent)).toEqual(['View your stake with your new wallet']);
  });
});
