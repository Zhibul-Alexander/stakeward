import type { Page, Route } from '@playwright/test';
import { getAddressEncoder, type Address } from '@solana/kit';

/**
 * Test double, Playwright only (never in the site's bundle): the worker's API as the built site reads it (CLAUDE.md
 * section 13, layer 4). It answers the stake account search, the RPC proxy for the reads the pages make
 * (getMultipleAccounts, the Clock sysvar, getEpochInfo, getBalance, getMinimumBalanceForRentExemption) and /api/health.
 * A method or path it does not know fails with HTTP 400, which the shared fixture reports as a console error.
 */

export const MAIN = 'B1agBSrGRgub2jXMJEozYkRLRzFc9HLd5hHjSrCtuXu8';
export const SECOND = '9DpLwZiYboWcwYFVtSjSksfaP9EqVoSuZw7Jofet96fi';
export const VOTE = '2YH4Dt2o14vVVS9wW8q1UkfodZLpE2Fj6cjTqCLFi4Tv';
export const ZERO = '11111111111111111111111111111111';

/** Cluster time of the mocked Clock sysvar: 2 October 2026 12:00 UTC, epoch 850. */
export const NOW = 1_790_942_400n;
export const EPOCH = 850n;
export const DAY = 86_400n;
export const SOL = 1_000_000_000n;

const U64_MAX = '18446744073709551615';
const SLOTS_IN_EPOCH = 432_000n;
const SLOT_INDEX = 1_000n;
const SLOT = EPOCH * SLOTS_IN_EPOCH + SLOT_INDEX;
const STAKE_PROGRAM = 'Stake11111111111111111111111111111111111111';
const SYSVAR_PROGRAM = 'Sysvar1111111111111111111111111111111111111';
const CLOCK_SYSVAR = 'SysvarC1ock11111111111111111111111111111111';

/** The rent-exempt minimum the way the cluster computes it: (128 + size) bytes × 3 480 lamports × 2 years. */
function rentExempt(size: number): bigint {
  return (128n + BigInt(size)) * 6_960n;
}

/** One stake account; every field left out takes the usual value (main key MAIN, staked, no lock). */
export type StakeMock = {
  lamports: bigint;
  staker?: string;
  withdrawer?: string;
  lockEnd?: bigint;
  custodian?: string;
  delegated?: boolean;
};

/** A stake account as GET /api/stake-accounts returns it (core's StakeAccountsJson). */
export function stakeJson(address: string, mock: StakeMock) {
  const withdrawer = mock.withdrawer ?? MAIN;
  const reserve = rentExempt(200);
  return {
    address,
    lamports: mock.lamports.toString(),
    kind: mock.delegated === false ? 'initialized' : 'delegated',
    rentExemptReserve: reserve.toString(),
    staker: mock.staker ?? withdrawer,
    withdrawer,
    lockup: { unixTimestamp: (mock.lockEnd ?? 0n).toString(), epoch: '0', custodian: mock.custodian ?? ZERO },
    delegation:
      mock.delegated === false
        ? null
        : { voter: VOTE, stake: (mock.lamports - reserve).toString(), activationEpoch: '700', deactivationEpoch: U64_MAX },
  };
}

export type StakeJson = ReturnType<typeof stakeJson>;

/** What the mocked cluster and worker hold. */
export type ApiFixture = {
  /** Every stake account on the cluster; the search filters them by main key or second key, as the worker does. */
  accounts: readonly StakeJson[];
  /** Wallet balances in lamports; any other address holds 0. */
  balances?: Readonly<Record<string, bigint>>;
  /** Minutes since the last monitoring pass that /api/health reports; 2 when left out. */
  healthAgeMin?: number;
  /** Receives the query string of every stake account search. */
  searches?: string[];
};

/** The stake account of the smoke loop (step 6 spec 13.3): not staked, locked by SECOND until NOW + 190 days. */
export const SMOKE_STAKE = '472uhJhLhUNK898jCeGUQ2XYA4PTLM7tqng7o7HB7jmD';

export const SMOKE_FIXTURE: ApiFixture = {
  accounts: [
    stakeJson(SMOKE_STAKE, { lamports: 1_250n * SOL + 500_000_000n, lockEnd: NOW + 190n * DAY, custodian: SECOND, delegated: false }),
  ],
  balances: { [MAIN]: SOL, [SECOND]: SOL / 100n },
};

const addressEncoder = getAddressEncoder();

/** A stake account as getMultipleAccounts returns it: the 200 bytes of CLAUDE.md section 4, base64. */
function stakeData(account: StakeJson): string {
  const data = Buffer.alloc(200);
  const key = (address: string, offset: number) => {
    data.set(addressEncoder.encode(address as Address), offset);
  };
  data.writeUInt32LE(account.delegation === null ? 1 : 2, 0);
  data.writeBigUInt64LE(BigInt(account.rentExemptReserve), 4);
  key(account.staker, 12);
  key(account.withdrawer, 44);
  data.writeBigInt64LE(BigInt(account.lockup.unixTimestamp), 76);
  data.writeBigUInt64LE(BigInt(account.lockup.epoch), 84);
  key(account.lockup.custodian, 92);
  if (account.delegation !== null) {
    key(account.delegation.voter, 124);
    data.writeBigUInt64LE(BigInt(account.delegation.stake), 156);
    data.writeBigUInt64LE(BigInt(account.delegation.activationEpoch), 164);
    data.writeBigUInt64LE(BigInt(account.delegation.deactivationEpoch), 172);
    data.writeDoubleLE(0.25, 180);
  }
  return data.toString('base64');
}

/** The Clock sysvar as getAccountInfo returns it: slot, epoch start, epoch, leader schedule epoch, unix time. */
function clockData(): string {
  const data = Buffer.alloc(40);
  data.writeBigUInt64LE(SLOT, 0);
  data.writeBigInt64LE(NOW - 3_600n, 8);
  data.writeBigUInt64LE(EPOCH, 16);
  data.writeBigUInt64LE(EPOCH + 1n, 24);
  data.writeBigInt64LE(NOW, 32);
  return data.toString('base64');
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

type RpcRequest = { id: number; method: string; params: unknown[] };

/** An account as getAccountInfo and getMultipleAccounts return it (base64 data). */
function accountInfo(data: string, owner: string, space: number, lamports: bigint) {
  return { data: [data, 'base64'], executable: false, lamports: Number(lamports), owner, space };
}

/** The JSON-RPC result for one call, or undefined when this mock does not answer it. */
function rpcResult(fixture: ApiFixture, request: RpcRequest): unknown {
  const context = { slot: Number(SLOT) };
  switch (request.method) {
    case 'getMultipleAccounts': {
      const keys = request.params[0] as string[];
      return {
        context,
        value: keys.map((address) => {
          const account = fixture.accounts.find((known) => known.address === address);
          return account === undefined ? null : accountInfo(stakeData(account), STAKE_PROGRAM, 200, BigInt(account.lamports));
        }),
      };
    }
    case 'getAccountInfo':
      if (request.params[0] !== CLOCK_SYSVAR) return undefined;
      return { context, value: accountInfo(clockData(), SYSVAR_PROGRAM, 40, rentExempt(40)) };
    case 'getEpochInfo':
      return {
        absoluteSlot: Number(SLOT),
        blockHeight: Number(SLOT) - 20_000_000,
        epoch: Number(EPOCH),
        slotIndex: Number(SLOT_INDEX),
        slotsInEpoch: Number(SLOTS_IN_EPOCH),
        transactionCount: 412_345_678_901,
      };
    case 'getBalance':
      return { context, value: Number(fixture.balances?.[request.params[0] as string] ?? 0n) };
    case 'getMinimumBalanceForRentExemption':
      return Number(rentExempt(request.params[0] as number));
    default:
      return undefined;
  }
}

/** Answers /api/stake-accounts, /api/rpc and /api/health on `page` from `fixture`. Call it before the first goto. */
export async function mockApi(page: Page, fixture: ApiFixture): Promise<void> {
  await page.route('**/api/stake-accounts?*', async (route) => {
    const url = new URL(route.request().url());
    fixture.searches?.push(url.search);
    const withdrawer = url.searchParams.get('withdrawer');
    const custodian = url.searchParams.get('custodian');
    const accounts = fixture.accounts.filter((account) =>
      withdrawer !== null ? account.withdrawer === withdrawer : account.lockup.custodian === custodian,
    );
    await json(route, { slot: SLOT.toString(), accounts });
  });
  await page.route('**/api/rpc', async (route) => {
    const request = route.request().postDataJSON() as RpcRequest;
    const result = rpcResult(fixture, request);
    if (result === undefined) {
      await json(route, { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: `Not mocked: ${request.method}` } }, 400);
      return;
    }
    await json(route, { jsonrpc: '2.0', id: request.id, result });
  });
  await page.route('**/api/health', async (route) => {
    const ageMin = fixture.healthAgeMin ?? 2;
    await json(route, { ok: ageMin <= 10, lastMonitorRunAt: new Date(Date.now() - ageMin * 60_000).toISOString() });
  });
}

/** What this device remembers, written to localStorage the way the site writes it, before every page load. */
export async function rememberOnDevice(
  page: Page,
  memory: { secondKeys?: readonly string[]; protectedAccounts?: readonly string[] },
): Promise<void> {
  await page.addInitScript((stored) => {
    if (stored.secondKeys !== undefined) localStorage.setItem('stakeward:second-keys:v1', JSON.stringify(stored.secondKeys));
    if (stored.protectedAccounts !== undefined) {
      localStorage.setItem('stakeward:protected-accounts:v1', JSON.stringify(stored.protectedAccounts));
    }
  }, memory);
}
