import type { Address, ReadonlyUint8Array } from '@solana/kit';
import { formatSol, shortAddress } from './format.ts';

/**
 * Validator health for the monitor's daily check (DECISIONS.md D128): will a native stake account delegated to this
 * vote account earn rewards? Read from the vote account alone, so the worker needs one getMultipleAccounts per 99
 * validators and no getVoteAccounts (its answer covers the whole cluster and would not fit the pass CPU budget).
 *
 * Layout: anza-xyz/solana-sdk vote-interface (bincode, little endian). VoteStateVersions tag u32, then:
 *   1 V1_14_11  node 32, withdrawer 32, commission u8, votes Vec<Lockout 12>, root Option<u64>, authorized_voters,
 *               prior_voters CircBuf (32 x 48 + u64 + bool), epoch_credits, last_timestamp
 *   2 V3        as V1_14_11 with votes Vec<LandedVote 13>
 *   3 V4        node 32, withdrawer 32, inflation_rewards_collector 32, block_revenue_collector 32,
 *               inflation_rewards_commission_bps u16, block_revenue_commission_bps u16, pending_delegator_rewards u64,
 *               bls_pubkey_compressed Option<[u8; 48]>, votes Vec<LandedVote 13>, root Option<u64>,
 *               authorized_voters, epoch_credits, last_timestamp (SIMD-0185, SIMD-0387)
 * authorized_voters is a BTreeMap<u64, Pubkey> (u64 count, 40 bytes each); epoch_credits a Vec<(u64, u64, u64)>
 * of (epoch, credits, prev_credits).
 */

export const VOTE_PROGRAM_ADDRESS = 'Vote111111111111111111111111111111111111111' as Address;

/** VoteStateV4::size_of(), the same as V3: every vote account is this size. */
export const VOTE_ACCOUNT_SIZE = 3762;

/**
 * Rent-exempt minimum of a vote account on every Solana cluster: (3762 + 128) bytes x 3480 lamports x 2 years.
 * A constant, as the rent rate has never changed; the monitor does not spend a call on it.
 */
export const VOTE_ACCOUNT_RENT_EXEMPT_LAMPORTS = 27_074_400n;

/**
 * Alpenglow's Validator Admission Ticket (SIMD-0357): 1.6 SOL a vote account pays at each epoch boundary to vote in the
 * next epoch. A vote account holding less than this plus its rent-exempt minimum is not admitted.
 */
export const ADMISSION_FEE_LAMPORTS = 1_600_000_000n;

/** The part of a vote account the health check needs. */
export type VoteAccountView = {
  version: 'v1_14_11' | 'v3' | 'v4';
  /** Inflation commission in basis points (V3 and older store whole percent). */
  commissionBps: number;
  /** A BLS pubkey is registered (V4 only; older versions cannot hold one). */
  hasBlsKey: boolean;
  /** Oldest first, as stored. */
  epochCredits: { epoch: bigint; credits: bigint; prevCredits: bigint }[];
};

/**
 * Decodes the fields of `data` that VoteAccountView keeps. Null for anything else: the wrong size, an uninitialized
 * or pre-1.14 account, or bytes that do not parse. The owner is the caller's to check.
 */
export function decodeVoteAccount(data: ReadonlyUint8Array): VoteAccountView | null {
  if (data.length !== VOTE_ACCOUNT_SIZE) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const r = new Reader(view);
  try {
    const tag = r.u32();
    if (tag === 3) {
      r.skip(32 * 4);
      const commissionBps = r.u16();
      r.skip(2 + 8);
      const hasBlsKey = r.option(48);
      r.skipVec(13);
      r.option(8);
      r.skipVec(40);
      return { version: 'v4', commissionBps, hasBlsKey, epochCredits: r.epochCredits() };
    }
    if (tag === 1 || tag === 2) {
      r.skip(32 * 2);
      const commissionBps = r.u8() * 100;
      r.skipVec(tag === 2 ? 13 : 12);
      r.option(8);
      r.skipVec(40);
      r.skip(32 * 48 + 8 + 1);
      return { version: tag === 2 ? 'v3' : 'v1_14_11', commissionBps, hasBlsKey: false, epochCredits: r.epochCredits() };
    }
    return null;
  } catch {
    return null;
  }
}

/** Why stake delegated to a validator may earn nothing, in the order alerts name them. */
export type ValidatorRisk = 'CLOSED' | 'NOT_VOTING' | 'NO_BLS_KEY' | 'LOW_FEE_BALANCE' | 'FULL_COMMISSION';

export const VALIDATOR_RISKS: readonly ValidatorRisk[] = [
  'CLOSED',
  'NOT_VOTING',
  'NO_BLS_KEY',
  'LOW_FEE_BALANCE',
  'FULL_COMMISSION',
];

/**
 * The risks of a validator at `epoch`, from its vote account as read (null: gone, or no longer a vote account).
 * - NOT_VOTING: no credits earned in the previous epoch or this one, so a whole epoch has gone by without a vote (a
 *   node minutes behind, which getVoteAccounts already calls delinquent, still earns and is not a risk).
 * - NO_BLS_KEY: since July 2026 a vote account without one is left out of the leader schedule and of consensus.
 * - LOW_FEE_BALANCE: below the admission fee plus rent (charged once Alpenglow is live).
 * - FULL_COMMISSION: the validator keeps every reward.
 * A vote account that does not decode (an old layout) gives no risk: unknown is not a reason to alarm anyone.
 */
export function validatorRisks(input: {
  account: { owner: Address; data: ReadonlyUint8Array; lamports: bigint } | null;
  epoch: bigint;
}): ValidatorRisk[] {
  const { account, epoch } = input;
  if (account === null || account.owner !== VOTE_PROGRAM_ADDRESS) return ['CLOSED'];
  const vote = decodeVoteAccount(account.data);
  if (vote === null) return [];
  const risks: ValidatorRisk[] = [];
  const earned = vote.epochCredits.some((e) => e.epoch + 1n >= epoch && e.credits > e.prevCredits);
  if (!earned) risks.push('NOT_VOTING');
  if (!vote.hasBlsKey) risks.push('NO_BLS_KEY');
  if (account.lamports < ADMISSION_FEE_LAMPORTS + VOTE_ACCOUNT_RENT_EXEMPT_LAMPORTS) risks.push('LOW_FEE_BALANCE');
  if (vote.commissionBps >= 10_000) risks.push('FULL_COMMISSION');
  return risks;
}

/** Risks in `now` that `before` did not have: what an alert is about. */
export function newValidatorRisks(before: readonly string[], now: readonly ValidatorRisk[]): ValidatorRisk[] {
  return now.filter((risk) => !before.includes(risk));
}

/** Details of a VALIDATOR_AT_RISK event. */
export type ValidatorRiskDetails = { voter: Address; risks: ValidatorRisk[] };

/**
 * Alert text for a VALIDATOR_AT_RISK event of `stakeAccount`. The button opens the owner's accounts page: moving the
 * stake is the owner's choice (deactivate, wait for the epoch to end, delegate to another validator), and Stakeward
 * names no validator to move to.
 */
export function formatValidatorAlert(input: {
  stakeAccount: Address;
  withdrawer: Address;
  details: ValidatorRiskDetails;
}): { text: string; buttonLabel: string; path: string } {
  const { stakeAccount, withdrawer, details } = input;
  const reasons = VALIDATOR_RISKS.filter((risk) => details.risks.includes(risk)).map(reasonText);
  if (reasons.length === 0) throw new Error('VALIDATOR_AT_RISK without a risk');
  const validator = `Validator ${shortAddress(details.voter)}, which stake ${shortAddress(stakeAccount)} is delegated to,`;
  const only = (risk: ValidatorRisk) => details.risks.every((r) => r === risk);
  const outcome = only('LOW_FEE_BALANCE')
    ? 'Once Alpenglow is live, this stake would earn no rewards there.'
    : only('FULL_COMMISSION')
      ? 'You get none of the rewards this stake earns.'
      : 'This stake earns no rewards while it stays there.';
  return {
    text:
      `${validator} ${joinReasons(reasons)}. ${outcome} Your SOL is safe. To earn again, move the stake to another ` +
      'validator: deactivate it, wait for the epoch to end, then delegate it.',
    buttonLabel: 'Open Stakeward',
    path: `/app?address=${withdrawer}`,
  };
}

function reasonText(risk: ValidatorRisk): string {
  switch (risk) {
    case 'CLOSED':
      return 'was closed';
    case 'NOT_VOTING':
      return 'has not voted for over an epoch';
    case 'NO_BLS_KEY':
      return 'has no BLS key, so the network leaves it out of consensus';
    case 'LOW_FEE_BALANCE':
      return `holds less than the ${formatSol(ADMISSION_FEE_LAMPORTS)} Alpenglow admission fee`;
    case 'FULL_COMMISSION':
      return 'keeps 100% of the rewards';
  }
}

function joinReasons(reasons: readonly string[]): string {
  if (reasons.length <= 1) return reasons.join('');
  return `${reasons.slice(0, -1).join(', ')} and ${reasons.at(-1) ?? ''}`;
}

class Reader {
  private at = 0;
  private readonly view: DataView;
  constructor(view: DataView) {
    this.view = view;
  }

  skip(n: number): void {
    if (n < 0 || this.at + n > this.view.byteLength) throw new RangeError('past the end');
    this.at += n;
  }
  u8(): number {
    const v = this.view.getUint8(this.at);
    this.at += 1;
    return v;
  }
  u16(): number {
    const v = this.view.getUint16(this.at, true);
    this.at += 2;
    return v;
  }
  u32(): number {
    const v = this.view.getUint32(this.at, true);
    this.at += 4;
    return v;
  }
  u64(): bigint {
    const v = this.view.getBigUint64(this.at, true);
    this.at += 8;
    return v;
  }
  /** Option<T> of `size` bytes: true when Some (skipped). */
  option(size: number): boolean {
    const tag = this.u8();
    if (tag === 0) return false;
    if (tag !== 1) throw new RangeError('bad option tag');
    this.skip(size);
    return true;
  }
  skipVec(itemSize: number): void {
    this.skip(this.count() * itemSize);
  }
  epochCredits(): VoteAccountView['epochCredits'] {
    const n = this.count();
    const out: VoteAccountView['epochCredits'] = [];
    for (let i = 0; i < n; i += 1) out.push({ epoch: this.u64(), credits: this.u64(), prevCredits: this.u64() });
    return out;
  }
  /** A bincode length; anything that cannot fit in the account is malformed. */
  private count(): number {
    const n = this.u64();
    if (n > BigInt(VOTE_ACCOUNT_SIZE)) throw new RangeError('bad length');
    return Number(n);
  }
}
