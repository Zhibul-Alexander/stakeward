import { isAddress, type Address } from '@solana/kit';
import {
  meetsOpenCriteria,
  shuffled,
  validatorRisks,
  type ChainPort,
  type ValidatorRisk,
  type VoteAccountListing,
} from '@stakeward/core';
import { isRecord, MAX_RETRIES, Transport } from './transport.ts';

/** A validator offered on /delegate: it met the open criteria and its vote account shows no risk (DECISIONS.md D134). */
export type ValidatorChoice = { voteAccount: Address; commission: number; activatedStake: bigint };

/**
 * Where /delegate gets validators to offer. Stakeward recommends none: it offers validators that meet open criteria, in
 * random order, and checks any vote account the person pastes by the same rules.
 */
export type ValidatorDirectory = {
  /** Up to `limit` validators that meet the open criteria and show no risk, in random order. */
  offer(limit: number): Promise<ValidatorChoice[]>;
  /** Risks of one vote account as read now (`CLOSED` when it is not a vote account). */
  risks(voteAccount: Address): Promise<ValidatorRisk[]>;
};

/** How many listed validators one offer reads (one getMultipleAccounts): enough that a few with risks still leave `limit`. */
export const OFFER_READ = 30;

/** The current (not delinquent) validators of a getVoteAccounts result; entries that do not parse are left out. */
export function parseVoteAccounts(result: unknown): VoteAccountListing[] {
  if (!isRecord(result) || !Array.isArray(result['current'])) throw new Error('getVoteAccounts: unexpected result');
  const out: VoteAccountListing[] = [];
  for (const entry of result['current'] as unknown[]) {
    if (!isRecord(entry)) continue;
    const { votePubkey, commission, activatedStake, epochVoteAccount } = entry;
    if (typeof votePubkey !== 'string' || !isAddress(votePubkey)) continue;
    if (typeof commission !== 'bigint' && typeof commission !== 'number') continue;
    if (typeof activatedStake !== 'bigint' && typeof activatedStake !== 'number') continue;
    if (typeof epochVoteAccount !== 'boolean') continue;
    out.push({ voteAccount: votePubkey, commission: Number(commission), activatedStake: BigInt(activatedStake), epochVoteAccount });
  }
  return out;
}

/**
 * The site's directory: getVoteAccounts through the worker's RPC proxy, then the vote accounts of a random sample read
 * through `chain` and checked with core `validatorRisks`. Nothing is cached: every offer is a new random order.
 */
export function createValidatorDirectory(chain: ChainPort, options: { rpcUrl?: string; random?: () => number } = {}): ValidatorDirectory {
  const transport = new Transport();
  const rpcUrl = options.rpcUrl ?? '/api/rpc';
  async function risksOf(addresses: readonly Address[]): Promise<ValidatorRisk[][]> {
    const [{ accounts }, clock] = await Promise.all([chain.getAccounts(addresses), chain.getClock()]);
    return addresses.map((_, index) => validatorRisks({ account: accounts[index] ?? null, epoch: clock.epoch }));
  }
  return {
    async offer(limit) {
      const result = await transport.rpc(rpcUrl, 'getVoteAccounts', [{ commitment: 'confirmed', keepUnstakedDelinquents: false }], {
        retries: MAX_RETRIES,
      });
      const sample = shuffled(parseVoteAccounts(result).filter(meetsOpenCriteria), options.random).slice(0, OFFER_READ);
      if (sample.length === 0) return [];
      const risks = await risksOf(sample.map((listing) => listing.voteAccount));
      return sample
        .filter((_, index) => risks[index]?.length === 0)
        .slice(0, limit)
        .map(({ voteAccount, commission, activatedStake }) => ({ voteAccount, commission, activatedStake }));
    },
    async risks(voteAccount) {
      const [risks] = await risksOf([voteAccount]);
      return risks ?? ['CLOSED'];
    },
  };
}
