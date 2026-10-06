import type { Address } from '@solana/kit';
import type { ChainPort, StakeAccount } from '@stakeward/core';
import { describe, expect, it, vi } from 'vitest';
import type { ApiPort } from '@/api/watch';
import {
  createProtectedAccountMemory,
  createSecondKeyMemory,
  createSlotStore,
  StaticWalletRegistry,
  type Ports,
} from '@/ports';
import { createPageSession } from './create.ts';
import type { SigningPlan } from './types.ts';

const IDS = Array.from({ length: 12 }, (_, i) => `account-${String(i)}`);

function ports(): Ports {
  return {
    chain: { marker: 'this page chain' } as unknown as ChainPort,
    wallets: new StaticWalletRegistry([]),
    slots: createSlotStore(null),
    secondKeys: createSecondKeyMemory(null),
    protectedAccounts: createProtectedAccountMemory(null),
    api: {} as ApiPort,
  };
}

/** Every job already done: the run ends without a transaction, a wallet or another read. `prepare` records its calls. */
function donePlan() {
  const prepare = vi.fn((_chain: ChainPort, ids: readonly string[]) =>
    Promise.resolve({
      clock: { slot: 1n, epochStartTimestamp: 1n, epoch: 1n, unixTimestamp: 1n },
      jobs: Object.fromEntries(ids.map((id) => [id, { kind: 'done', after: { address: id as Address } as StakeAccount } as const])),
    }),
  );
  const plan: SigningPlan = { prepare };
  return { plan, prepare };
}

describe('createPageSession', () => {
  it("runs the plan on the page's chain, in rounds of at most 10 by default, and reports the end", async () => {
    const page = ports();
    const { plan, prepare } = donePlan();
    const onFinished = vi.fn();
    const session = createPageSession(page, { plan, ids: IDS, onFinished });
    expect(session.getSnapshot().roundSize).toBe(10);
    session.start();
    await vi.waitFor(() => {
      expect(onFinished).toHaveBeenCalledTimes(1);
    });
    expect(prepare).toHaveBeenNthCalledWith(1, page.chain, IDS.slice(0, 10));
    expect(prepare).toHaveBeenNthCalledWith(2, page.chain, IDS.slice(10));
    expect(session.getSnapshot().phase.kind).toBe('finished');
    session.dispose();
  });

  it('a plan on a durable nonce signs one stake account per round, whatever the page asks', () => {
    const plan: SigningPlan = {
      ...donePlan().plan,
      nonce: { nonceAccount: 'nonce' as Address, nonceAuthority: 'authority' as Address },
    };
    const session = createPageSession(ports(), { plan, ids: IDS, roundSize: 5 });
    expect(session.getSnapshot().roundSize).toBe(1);
    session.dispose();
  });

  it('takes the round size a page asks for', () => {
    const signing = { pollIntervalMs: 1, rereadDelayMs: 1 };
    const session = createPageSession(ports(), { plan: donePlan().plan, ids: IDS, roundSize: 1, signing });
    expect(session.getSnapshot().roundSize).toBe(1);
    expect(session.getSnapshot().ids).toEqual(IDS);
    session.dispose();
  });
});
