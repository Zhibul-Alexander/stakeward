// Sends gate transactions: rebuilds a transaction whose blockhash expired before it landed, and keeps a ledger of
// who paid which fee (gate.test.ts checks the ledger against the budget plan).
import type { Address, Instruction, KeyPairSigner } from '@solana/kit';
import { buildTransaction, expectedFeePayer, type Lifetime, type TransactionAction } from '@stakeward/core';
import type { Role } from './budget.ts';
import type { GateChain, TxOutcome } from './chain.ts';
import { buildFormatted, requiredSigners, signWith, transactionFee } from './tx.ts';

/** Signed wire bytes and the lifetime they were built with. */
export type Built = { bytes: Uint8Array; lifetime: Lifetime };
/** The final outcome and the bytes of the attempt it belongs to. */
export type Sent = { outcome: TxOutcome; bytes: Uint8Array };
export type FeeEntry = { label: string; payer: Role | Address; signatures: number; fee: bigint };

/** A blockhash transaction that never landed is built again with a new blockhash, up to this many times in all. */
const MAX_ATTEMPTS = 3;

export type Sender = {
  readonly chain: GateChain;
  readonly fees: FeeEntry[];
  send(label: string, make: () => Promise<Built>): Promise<Sent>;
  /** A product transaction from core's builder, signed by `signers`. The fee payer defaults to `expectedFeePayer`. */
  product(action: TransactionAction, signers: readonly KeyPairSigner[], feePayer?: Address): () => Promise<Built>;
  /** Instructions in the section 4 format (see buildFormatted), paid by `feePayer`, signed by `signers`. */
  formatted(instructions: readonly Instruction[], feePayer: Address, signers: readonly KeyPairSigner[]): () => Promise<Built>;
};

export function createSender(chain: GateChain, roles: ReadonlyMap<Address, Role>, log: (line: string) => void): Sender {
  const fees: FeeEntry[] = [];
  return {
    chain,
    fees,
    async send(label, make) {
      for (let attempt = 1; ; attempt++) {
        const { bytes, lifetime } = await make();
        const outcome = await chain.send(bytes, lifetime);
        const charged = outcome.status === 'ok' || (outcome.status === 'failed' && outcome.error.kind !== 'transaction');
        if (charged) {
          const signers = requiredSigners(bytes);
          const payer = signers[0];
          if (payer === undefined) throw new Error(`${label}: transaction without a fee payer`);
          fees.push({ label, payer: roles.get(payer) ?? payer, signatures: signers.length, fee: transactionFee(signers.length) });
        }
        if (outcome.status !== 'dropped' || lifetime.kind === 'nonce' || attempt === MAX_ATTEMPTS) {
          return { outcome, bytes };
        }
        log(`${label}: not landed before its blockhash expired, building it again`);
      }
    },
    product(action, signers, feePayer) {
      return async () => {
        const lifetime = await chain.lifetime();
        const built = buildTransaction(action, { feePayer: feePayer ?? expectedFeePayer(action), lifetime });
        return { bytes: await signWith(built.bytes, signers), lifetime };
      };
    },
    formatted(instructions, feePayer, signers) {
      return async () => {
        const lifetime = await chain.lifetime();
        return { bytes: await signWith(buildFormatted(instructions, feePayer, lifetime), signers), lifetime };
      };
    },
  };
}
