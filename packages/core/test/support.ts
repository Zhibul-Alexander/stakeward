// Test support without LiteSVM: the stake program build every test chain runs and the plain-data shape of a failed
// transaction. Shared by the LiteSVM harness (svm.ts) and by scripts/gate (which also talks to devnet and mainnet).
import * as kit from '@solana/kit';
import {
  isSolanaError,
  SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
  SOLANA_ERROR__INSTRUCTION_ERROR__UNKNOWN,
  SOLANA_ERROR__TRANSACTION_ERROR__UNKNOWN,
  type SolanaError,
} from '@solana/kit';

/** The committed mainnet stake program build (DECISIONS.md D4, fixtures/programs/README.md). */
export const STAKE_PROGRAM_PATH = new URL('./fixtures/programs/stake-v5.1.0.so', import.meta.url);
export const STAKE_PROGRAM_SHA256 = '3d2d39c596ce8be2d47816b4ee5db9fc759d80fde54b08c930ad0b6daed64c2c';
/** GitHub release tag of that build (solana-program/stake). */
export const STAKE_PROGRAM_RELEASE = 'program@v5.1.0';

/** Upgradeable loader programdata header: u32 tag, u64 deploy slot, Option<Pubkey> upgrade authority. */
export const PROGRAMDATA_HEADER_SIZE = 45;

/** Why a transaction failed, as plain data. */
export type ChainError =
  /** A program returned a custom error code, e.g. 1 = LockupInForce for the stake program. */
  | { kind: 'custom'; code: number; index: number }
  /** A built-in instruction error, e.g. MissingRequiredSignature. `index` counts every instruction. */
  | { kind: 'instruction'; name: string; index: number }
  /** Rejected before execution, e.g. BlockhashNotFound. */
  | { kind: 'transaction'; name: string };

const INSTRUCTION_ERROR_PREFIX = 'SOLANA_ERROR__INSTRUCTION_ERROR__';
const TRANSACTION_ERROR_PREFIX = 'SOLANA_ERROR__TRANSACTION_ERROR__';

/** kit error code -> runtime error name, e.g. 4615008 -> MissingRequiredSignature, 7050008 -> BlockhashNotFound. */
const ERROR_NAMES = new Map<number, string>(
  Object.entries(kit).flatMap(([key, value]) => {
    const prefix = [INSTRUCTION_ERROR_PREFIX, TRANSACTION_ERROR_PREFIX].find((p) => key.startsWith(p));
    return prefix === undefined || typeof value !== 'number' ? [] : [[value, pascalCase(key.slice(prefix.length))]];
  }),
);

/** `LOCKUP_IN_FORCE` -> `LockupInForce`. */
export function pascalCase(constantCase: string): string {
  return constantCase
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/**
 * Maps the `SolanaError` of a failed transaction (from LiteSVM via getSolanaErrorFromLiteSvmFailure, or from an RPC
 * status via getSolanaErrorFromTransactionError) to plain data with the runtime's error names.
 */
export function chainErrorFromSolanaError(error: SolanaError): ChainError {
  if (isSolanaError(error, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM)) {
    return { kind: 'custom', code: error.context.code, index: error.context.index };
  }
  const code = error.context.__code;
  const context: Record<string, unknown> = error.context;
  const unknownName = typeof context['errorName'] === 'string' ? context['errorName'] : undefined;
  const name =
    (code === SOLANA_ERROR__INSTRUCTION_ERROR__UNKNOWN || code === SOLANA_ERROR__TRANSACTION_ERROR__UNKNOWN
      ? unknownName
      : undefined) ??
    ERROR_NAMES.get(code) ??
    `SolanaError ${String(code)}`;
  const index = context['index'];
  return typeof index === 'number' ? { kind: 'instruction', name, index } : { kind: 'transaction', name };
}
