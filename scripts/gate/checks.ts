// The checks of CLAUDE.md step 1, what each one expects, and how an outcome is matched against it.
import * as stakeClient from '@solana-program/stake';
import {
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type Address,
} from '@solana/kit';
import {
  STAKE_ERROR__CUSTODIAN_MISSING,
  STAKE_ERROR__LOCKUP_IN_FORCE,
  STAKE_ERROR__MERGE_MISMATCH,
} from '@solana-program/stake';
import { STAKE_PROGRAM_ADDRESS } from '@stakeward/core';
import { pascalCase, type ChainError } from '@stakeward/core/test/support';
import type { GateCluster, TxOutcome } from './chain.ts';

/** Stake program errors the checks expect, by name (CLAUDE.md section 4). */
const STAKE_ERRORS = {
  LockupInForce: STAKE_ERROR__LOCKUP_IN_FORCE,
  CustodianMissing: STAKE_ERROR__CUSTODIAN_MISSING,
  MergeMismatch: STAKE_ERROR__MERGE_MISMATCH,
} as const;

/**
 * What a check expects. `any-failure`: the transaction fails inside a stake instruction, whatever the error
 * (after a rescue, anything signed by the old main key must fail).
 */
export type Expectation = 'success' | keyof typeof STAKE_ERRORS | 'MissingRequiredSignature' | 'any-failure';

/** Stake program custom error code -> name, from the generated client (`STAKE_ERROR__LOCKUP_IN_FORCE` -> 1 ...). */
const STAKE_ERROR_NAMES = new Map<number, string>(
  Object.entries(stakeClient).flatMap(([key, value]) =>
    key.startsWith('STAKE_ERROR__') && typeof value === 'number'
      ? [[value, pascalCase(key.slice('STAKE_ERROR__'.length))]]
      : [],
  ),
);

type CheckSpec = {
  id: string;
  title: string;
  /** Title on mainnet, where S1 is the only account (checks 1a and 13). */
  mainnetTitle?: string;
  expected: Expectation;
  clusters: readonly GateCluster[];
};

const ALL: readonly GateCluster[] = ['litesvm', 'devnet', 'mainnet'];
const FULL: readonly GateCluster[] = ['litesvm', 'devnet'];

/** Every row of the gate table, in run order. */
export const CHECKS: readonly CheckSpec[] = [
  {
    id: '1a',
    title: 'Создать стейк-аккаунт S1: staker = withdrawer = A, без замка, 1 SOL сверх залога',
    mainnetTitle: 'Создать неделегированный стейк-аккаунт S1: staker = withdrawer = A, без замка',
    expected: 'success',
    clusters: ALL,
  },
  { id: '1b', title: 'Делегировать S1: DelegateStake с подписью A', expected: 'success', clusters: FULL },
  {
    id: '2',
    title: 'Главное утверждение. SetLockupChecked на S1 с подписями A и B: unix_timestamp = сейчас + 1 час, хранитель B',
    expected: 'success',
    clusters: ALL,
  },
  { id: '3', title: 'Withdraw всего S1 с подписью только A', expected: 'LockupInForce', clusters: ALL },
  {
    id: '4',
    title: 'AuthorizeChecked(Withdrawer -> X) с подписями A и X, без хранителя',
    expected: 'CustodianMissing',
    clusters: ALL,
  },
  {
    id: '5',
    title: 'SetLockup (unix_timestamp = 0) с подписью A при действующем замке',
    expected: 'MissingRequiredSignature',
    clusters: ALL,
  },
  { id: '6', title: 'SetLockup с подписью B: продление до сейчас + 2 часа', expected: 'success', clusters: ALL },
  { id: '7a', title: 'Вор с ключом A: Deactivate S1 с подписью A', expected: 'success', clusters: FULL },
  {
    id: '7b',
    title: 'Вор с ключом A: AuthorizeChecked(Staker -> X) с подписями A и X',
    expected: 'success',
    clusters: FULL,
  },
  { id: '8a', title: 'Split S1 в S2 (подпись staker X): у S2 тот же замок', expected: 'success', clusters: FULL },
  { id: '8b', title: 'Withdraw всего S2 с подписью только A', expected: 'LockupInForce', clusters: FULL },
  {
    id: '9',
    title: 'Merge незапертого Sm (staker X, withdrawer A, как у S1) в запертый S1',
    expected: 'MergeMismatch',
    clusters: FULL,
  },
  {
    id: '10',
    title: 'Withdraw 0,25 SOL из запертого неделегированного S2 с подписями A и B',
    expected: 'success',
    clusters: FULL,
  },
  {
    id: '11a',
    title:
      'Спасение S1 после шага 7, одна транзакция, комиссию платит D: AuthorizeChecked(Staker -> D) с подписями A и D ' +
      'и AuthorizeChecked(Withdrawer -> D) с подписями A, D и B',
    expected: 'success',
    clusters: FULL,
  },
  { id: '11b', title: 'После спасения: Withdraw из S1 с подписями A и B', expected: 'any-failure', clusters: FULL },
  {
    id: '11c',
    title: 'После спасения: AuthorizeChecked(Staker -> X) на S1 с подписями A и X',
    expected: 'any-failure',
    clusters: FULL,
  },
  {
    id: '12a',
    title: 'D создаёт nonce-аккаунт (CreateAccountWithSeed + InitializeNonceAccount, authority D)',
    expected: 'success',
    clusters: FULL,
  },
  {
    id: '12b',
    title:
      'То же спасение запертого S3 на durable nonce D: подписи D, A, B добавляются по одной, между ними транзакция ' +
      'уходит в ссылку /cosign#tx= и разбирается обратно',
    expected: 'success',
    clusters: FULL,
  },
  { id: '12c', title: 'D закрывает nonce-аккаунт и забирает залог', expected: 'success', clusters: FULL },
  {
    id: '13a',
    title: 'B ставит unix_timestamp = 0 на запертом S2',
    mainnetTitle: 'B ставит unix_timestamp = 0 на S1 (комиссию платит A)',
    expected: 'success',
    clusters: ALL,
  },
  {
    id: '13b',
    title: 'Withdraw всего S2 с подписью только A',
    mainnetTitle: 'Withdraw всего S1 с подписью только A, обратно на одноразовый ключ',
    expected: 'success',
    clusters: ALL,
  },
  { id: '14a', title: 'S4 заперт B до T: Withdraw с подписью только A', expected: 'LockupInForce', clusters: ['litesvm'] },
  {
    id: '14b',
    title: 'Часы переведены за T: SetLockup (unix_timestamp = 0) с подписью только A',
    expected: 'success',
    clusters: ['litesvm'],
  },
  { id: '14c', title: 'Withdraw всего S4 с подписью только A', expected: 'success', clusters: ['litesvm'] },
];

export function checksFor(cluster: GateCluster): { id: string; title: string; expected: Expectation }[] {
  return CHECKS.filter((check) => check.clusters.includes(cluster)).map((check) => ({
    id: check.id,
    title: (cluster === 'mainnet' ? check.mainnetTitle : undefined) ?? check.title,
    expected: check.expected,
  }));
}

/** Program of the instruction at `index` in a wire transaction. */
function programAt(bytes: Uint8Array, index: number): Address | undefined {
  const message = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(bytes).messageBytes);
  if (message.version === 1) return undefined; // the gate only builds legacy messages
  const instruction = message.instructions[index];
  return instruction === undefined ? undefined : message.staticAccounts[instruction.programAddressIndex];
}

export function outcomeMatches(expected: Expectation, outcome: TxOutcome, bytes: Uint8Array): boolean {
  if (expected === 'success') return outcome.status === 'ok';
  if (outcome.status !== 'failed' || outcome.error.kind === 'transaction') return false;
  if (programAt(bytes, outcome.error.index) !== STAKE_PROGRAM_ADDRESS) return false;
  const { error } = outcome;
  switch (expected) {
    case 'any-failure':
      return true;
    case 'MissingRequiredSignature':
      return error.kind === 'instruction' && error.name === 'MissingRequiredSignature';
    default:
      return error.kind === 'custom' && error.code === STAKE_ERRORS[expected];
  }
}

/** `LockupInForce (код 1), инструкция 3`; instruction numbers are 1-based, as in explorers. */
export function describeError(error: ChainError, bytes: Uint8Array): string {
  if (error.kind === 'transaction') return error.name;
  const position = `инструкция ${String(error.index + 1)}`;
  if (error.kind === 'instruction') return `${error.name}, ${position}`;
  const name = programAt(bytes, error.index) === STAKE_PROGRAM_ADDRESS ? STAKE_ERROR_NAMES.get(error.code) : undefined;
  return `${name ?? 'Custom'} (код ${String(error.code)}), ${position}`;
}

export function describeExpectation(expected: Expectation): string {
  switch (expected) {
    case 'success':
      return 'успех';
    case 'any-failure':
      return 'любая ошибка стейк-программы';
    default:
      return `ошибка ${expected}`;
  }
}
