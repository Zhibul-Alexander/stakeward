import type { Address } from '@solana/kit';
import type { ChainClock, ChainPort, StakeAccount, TransactionAction, WalletPort, WalletRole } from '@stakeward/core';

/** What a page's plan decided for one job (one stake account) after reading the chain. */
export type JobPlan =
  /** Build, simulate and sign this action. `before` is the account as just read. */
  | { kind: 'build'; action: TransactionAction; feePayer: Address; before: StakeAccount | null }
  /**
   * Sign these bytes as they are (/cosign: a link's partly signed transaction). Inspected, simulated and fee-checked like
   * a build, never rebuilt; only a durable-nonce lifetime is accepted.
   */
  | {
      kind: 'bytes';
      bytes: Uint8Array;
      before: StakeAccount | null;
      /** The context slot of the plan's read that found the bytes' nonce value (see JobView.nonceSlot). */
      nonceSlot?: bigint | undefined;
    }
  /**
   * The chain already shows the change (a retry after a late landing): nothing to sign. `after` is null when the target
   * is not a stake account (a nonce account) or no longer exists (a withdrawal closed it).
   */
  | { kind: 'done'; after: StakeAccount | null }
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
  /**
   * Build every 'build' job on this durable nonce instead of a recent blockhash (signing by link, rescue). Forces rounds
   * of one transaction: each transaction consumes the nonce. The authority is always the fee payer and always signs in
   * this browser (CLAUDE.md section 5: a possibly stolen key never owns the nonce).
   */
  nonce?: { nonceAccount: Address; nonceAuthority: Address } | undefined;
  /**
   * Signers who sign on another device through a /cosign link. Needs `nonce`; never the fee payer or the nonce
   * authority. They sign last: after the last signature here the round waits for the link (phase `link`).
   */
  remote?: readonly Address[] | undefined;
  /**
   * One-tap rescue kit (D118): each fully signed transaction goes here instead of to the chain, and its job ends `done`
   * with the account as read before (the chain has not changed). A rejection fails the job. Never with `remote`: the
   * last signer would send it from /cosign.
   */
  deliver?: ((bytes: Uint8Array) => Promise<void>) | undefined;
};

/** Which connected wallet signs for an address. */
export type SignerResolution =
  | { kind: 'ready'; role: WalletRole; wallet: WalletPort }
  /** No slot holds the address, or the slot's wallet is not in this browser. */
  | { kind: 'missing'; role: WalletRole };

export type SignerResolver = (address: Address, hint: WalletRole | null) => SignerResolution;
