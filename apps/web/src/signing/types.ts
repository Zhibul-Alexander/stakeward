import type { Address } from '@solana/kit';
import type { ChainClock, ChainPort, StakeAccount, TransactionAction, WalletPort, WalletRole } from '@stakeward/core';

/** What a page's plan decided for one job (one stake account) after reading the chain. */
export type JobPlan =
  /** Build, simulate and sign this action. `before` is the account as just read. */
  | { kind: 'build'; action: TransactionAction; feePayer: Address; before: StakeAccount | null }
  /** The chain already shows the change (a retry after a late landing): nothing to sign. */
  | { kind: 'done'; after: StakeAccount }
  /** Not possible now; the page maps `reason` to text. */
  | { kind: 'refused'; reason: string; before: StakeAccount | null };

/** A page's side of the engine: what to do for each job, decided from fresh chain reads. */
export type SigningPlan = {
  /**
   * Fresh reads (never a cached search) for these jobs; decides each one. Rejects only on a transport or RPC failure.
   * Called again for every round, every retry and every rebuild, so a late landing is seen as `done`.
   */
  prepare(
    chain: ChainPort,
    ids: readonly string[],
  ): Promise<{ clock: ChainClock; jobs: Readonly<Record<string, JobPlan>> }>;
};

/** Which connected wallet signs for an address. */
export type SignerResolution =
  | { kind: 'ready'; role: WalletRole; wallet: WalletPort }
  /** No slot holds the address, or the slot's wallet is not in this browser. */
  | { kind: 'missing'; role: WalletRole };

export type SignerResolver = (address: Address, hint: WalletRole | null) => SignerResolution;
