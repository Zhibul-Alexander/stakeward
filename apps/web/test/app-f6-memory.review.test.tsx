// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { getAddressDecoder, type Address } from '@solana/kit';
import { U64_MAX, type ChainPort, type StakeAccount, type StakeAccountFilter } from '@stakeward/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { AppPage } from '@/pages/AppPage';
import {
  createProtectedAccountMemory,
  createSecondKeyMemory,
  createSlotStore,
  MAX_REMEMBERED_PROTECTED_ACCOUNTS,
  PortsProvider,
  StaticWalletRegistry,
  type Ports,
} from '@/ports';
import { createFakeApi } from './support/fake-api.ts';
import { rawStakeAccount } from './support/raw-stake.ts';

// Review (security lens; F6 in CLAUDE.md section 7, the red banner when a stake that was protected stands without a
// lock). The device memory behind F6 is filled by viewing ANY address: every account of the viewed address whose lock
// a known second key holds is remembered, newest first, at most 200. Anyone can put any custodian on their own stake
// account (unchecked SetLockup needs no custodian signature), and a second key is public once it locks a stake. So a
// link /app?address=<attacker> with enough accounts locked to the victim's second key pushes the victim's own
// accounts out of the memory, and the F6 banner no longer appears when the victim's lock is later removed or ends.

const DAY = 86_400n;
const SOL = 1_000_000_000n;
const clock = { unixTimestamp: 1_800_000_000n, epoch: 900n, slot: 1n };
let counter = 1;
const fresh = (): Address => {
  const bytes = new Uint8Array(32);
  new DataView(bytes.buffer).setUint32(0, counter++);
  bytes[31] = 7;
  return getAddressDecoder().decode(bytes);
};

function stake(withdrawer: Address, custodian: Address): StakeAccount {
  return {
    address: fresh(),
    lamports: 2n * SOL,
    kind: 'delegated',
    rentExemptReserve: 1_666_240n,
    staker: withdrawer,
    withdrawer,
    lockup: { unixTimestamp: clock.unixTimestamp + 2n * DAY, epoch: 0n, custodian },
    delegation: { voter: fresh(), stake: 2n * SOL, activationEpoch: 800n, deactivationEpoch: U64_MAX },
  };
}

describe('review: F6 memory can be flushed by viewing an address that is not the viewer', () => {
  it("viewing someone else's address does not evict the viewer's remembered protected accounts", async () => {
    const victimSecondKey = fresh();
    const victimAccount = fresh();
    const attacker = fresh();
    const decoys = Array.from({ length: MAX_REMEMBERED_PROTECTED_ACCOUNTS }, () => stake(attacker, victimSecondKey));
    const chain = {
      findStakeAccounts: (filter: StakeAccountFilter) =>
        Promise.resolve({ slot: 1n, accounts: 'withdrawer' in filter && filter.withdrawer === attacker ? decoys : [] }),
      getAccounts: (addresses: readonly Address[]) =>
        Promise.resolve({
          slot: 1n,
          accounts: addresses.map((address) => {
            const decoy = decoys.find((account) => account.address === address);
            return decoy === undefined ? null : rawStakeAccount(decoy);
          }),
        }),
      getClock: () => Promise.resolve(clock),
    } as unknown as ChainPort;
    const ports: Ports = {
      chain,
      wallets: new StaticWalletRegistry([]),
      slots: createSlotStore(null),
      secondKeys: createSecondKeyMemory(null),
      protectedAccounts: createProtectedAccountMemory(null),
      api: createFakeApi(),
    };
    // The victim protected their stake on this device earlier.
    ports.secondKeys.remember(victimSecondKey);
    ports.protectedAccounts.remember([victimAccount]);

    const location = memoryLocation({ path: `/app?address=${attacker}`, record: true });
    render(
      <Router hook={location.hook} searchHook={location.searchHook}>
        <PortsProvider ports={ports}>
          <AppPage loadHealth={() => Promise.resolve({ lastMonitorRunAt: null })} />
        </PortsProvider>
      </Router>,
    );
    await screen.findAllByRole('article');

    expect(ports.protectedAccounts.getSnapshot(), "the victim's own account was pushed out of the F6 memory").toContain(
      victimAccount,
    );
    // 200 rows and a role query over them take about 5 s in jsdom on their own: more than Vitest's default limit.
  }, 30_000);
});
