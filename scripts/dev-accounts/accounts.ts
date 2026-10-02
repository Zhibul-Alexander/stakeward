// Devnet stake accounts for testing the site with a real wallet (CLAUDE.md step 3): one delegated and one undelegated
// stake account whose staker and withdrawer are a given address, no lockup.
//
// The script cannot sign for that wallet, so the funder signs alone. These are setup transactions, not product
// transactions: they do not go through the inspector, and they use instructions the product never sends:
//   undelegated: CreateAccountWithSeed + Initialize(staker = withdrawer = target)
//   delegated:   CreateAccountWithSeed + Initialize(staker = funder, withdrawer = target) + DelegateStake (funder)
//                + Authorize(Staker -> target), unchecked: AuthorizeChecked needs the new authority's signature.
// Initialize needs no signature from the authorities it names, so the withdrawer is the target from the start and the
// funder never holds withdraw authority; it is the staker only inside the one atomic transaction that delegates.
import {
  createAddressWithSeed,
  createNoopSigner,
  isOffCurveAddress,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type Signature,
} from '@solana/kit';
import {
  getAuthorizeInstruction,
  getDelegateStakeInstruction,
  getInitializeInstruction,
  StakeAuthorize,
} from '@solana-program/stake';
import { getCreateAccountWithSeedInstruction } from '@solana-program/system';
import {
  decodeStakeAccount,
  formatSol,
  STAKE_ACCOUNT_SIZE,
  STAKE_PROGRAM_ADDRESS,
  SYSTEM_PROGRAM_ADDRESS,
  U64_MAX,
  ZERO_ADDRESS,
  type Lockup,
  type StakeAccount,
} from '@stakeward/core';
import { MIN_DELEGATION_LAMPORTS, readRents } from '../gate/budget.ts';
import type { GateChain } from '../gate/chain.ts';
import { describeError } from '../gate/checks.ts';
import { createSender } from '../gate/sender.ts';
import { transactionFee } from '../gate/tx.ts';

export type AccountKind = 'delegated' | 'undelegated';
export const ACCOUNT_KINDS: readonly AccountKind[] = ['delegated', 'undelegated'];

export type DevAccountsOptions = {
  /** The wallet that becomes staker and withdrawer of every account. */
  target: Address;
  kinds: readonly AccountKind[];
  /** Stake of the delegated account on top of its rent reserve: at least the minimum delegation (1 SOL). */
  delegatedLamports: bigint;
  /** Lamports of the undelegated account on top of its rent reserve. */
  undelegatedLamports: bigint;
  /** Makes the seeds, and so the addresses, of this run unique. */
  runId: string;
};

export type PlannedAccount = {
  kind: AccountKind;
  /** Derived from the funder and `seed` (CreateAccountWithSeed), so no throwaway key is needed. */
  address: Address;
  seed: string;
  /** Balance at creation: the rent reserve plus `extra`. */
  lamports: bigint;
  /** Delegated stake, or the spare lamports of the undelegated account. */
  extra: bigint;
};

export type DevAccountsPlan = {
  funder: Address;
  target: Address;
  /** The validator the delegated account is delegated to; null without a delegated account. */
  voteAccount: Address | null;
  accounts: PlannedAccount[];
  rentReserve: bigint;
  /** One transaction signed by the funder per account. */
  fees: bigint;
  /** What the run takes from the funder: the account balances (the target controls them afterwards) and the fees. */
  cost: bigint;
  /** `cost` plus the funder's own rent reserve: a fee payer must stay rent-exempt. */
  required: bigint;
  /** The funder's balance when the plan was made. */
  balance: bigint;
};

export type CreatedAccount = PlannedAccount & { signature: Signature; state: StakeAccount };

/** A request the script refuses: bad target, too little stake, too little SOL on the funder. Exit code 1, no trace. */
export class DevAccountsRefusal extends Error {
  override name = 'DevAccountsRefusal';
}

const NO_LOCKUP: Lockup = { unixTimestamp: 0n, epoch: 0n, custodian: ZERO_ADDRESS };
/** CreateAccountWithSeed accepts seeds of up to 32 bytes. */
const MAX_SEED_LENGTH = 32;

/** Explorer links in the printout; the script only ever runs on devnet. */
export function explorerUrl(kind: 'address' | 'tx', value: string): string {
  return `https://explorer.solana.com/${kind}/${value}?cluster=devnet`;
}

/** Reads what the plan needs from the chain (rent, balances, a vote account) and checks the request. Sends nothing. */
export async function planDevAccounts(
  chain: Pick<GateChain, 'rentExempt' | 'balance' | 'account' | 'voteAccount'>,
  funder: Address,
  options: DevAccountsOptions,
): Promise<DevAccountsPlan> {
  const { target, kinds, runId } = options;
  if (kinds.length === 0) throw new DevAccountsRefusal('Nothing to create');
  if (target === funder) {
    throw new DevAccountsRefusal(`${target} is the funder itself; pass the address of the wallet you test with`);
  }
  if (isOffCurveAddress(target)) {
    throw new DevAccountsRefusal(`${target} is not a wallet address (no key can sign for it), refusing`);
  }
  const existing = await chain.account(target);
  if (existing !== null && existing.owner !== SYSTEM_PROGRAM_ADDRESS) {
    throw new DevAccountsRefusal(`${target} is an account of program ${existing.owner}, not a wallet`);
  }
  if (options.undelegatedLamports < 0n || options.delegatedLamports < 0n) {
    throw new DevAccountsRefusal('Amounts cannot be negative');
  }
  if (kinds.includes('delegated') && options.delegatedLamports < MIN_DELEGATION_LAMPORTS) {
    throw new DevAccountsRefusal(
      `The delegated account needs at least ${formatSol(MIN_DELEGATION_LAMPORTS)} of stake (minimum delegation), ` +
        `got ${formatSol(options.delegatedLamports)}`,
    );
  }

  const rents = await readRents(chain);
  const accounts: PlannedAccount[] = [];
  for (const kind of ACCOUNT_KINDS.filter((k) => kinds.includes(k))) {
    const seed = `dev-${runId}-${kind}`;
    if (seed.length > MAX_SEED_LENGTH) throw new Error(`Seed ${seed} is longer than ${String(MAX_SEED_LENGTH)} bytes`);
    const extra = kind === 'delegated' ? options.delegatedLamports : options.undelegatedLamports;
    const address = await createAddressWithSeed({ baseAddress: funder, programAddress: STAKE_PROGRAM_ADDRESS, seed });
    accounts.push({ kind, address, seed, lamports: rents.stake + extra, extra });
  }
  const fees = BigInt(accounts.length) * transactionFee(1);
  const cost = accounts.reduce((sum, account) => sum + account.lamports, 0n) + fees;
  return {
    funder,
    target,
    voteAccount: kinds.includes('delegated') ? await chain.voteAccount() : null,
    accounts,
    rentReserve: rents.stake,
    fees,
    cost,
    required: cost + rents.wallet,
    balance: await chain.balance(funder),
  };
}

/** The setup instructions of one account; the funder pays and is the only signer. */
export function setupInstructions(plan: DevAccountsPlan, account: PlannedAccount): Instruction[] {
  const funder = createNoopSigner(plan.funder);
  const create = getCreateAccountWithSeedInstruction({
    payer: funder,
    newAccount: account.address,
    base: plan.funder,
    seed: account.seed,
    amount: account.lamports,
    space: STAKE_ACCOUNT_SIZE,
    programAddress: STAKE_PROGRAM_ADDRESS,
  });
  if (account.kind === 'undelegated') {
    return [
      create,
      getInitializeInstruction({
        stake: account.address,
        arg0: { staker: plan.target, withdrawer: plan.target },
        arg1: NO_LOCKUP,
      }),
    ];
  }
  if (plan.voteAccount === null) throw new Error('The plan has a delegated account but no vote account');
  return [
    create,
    getInitializeInstruction({
      stake: account.address,
      arg0: { staker: plan.funder, withdrawer: plan.target },
      arg1: NO_LOCKUP,
    }),
    getDelegateStakeInstruction({ stake: account.address, vote: plan.voteAccount, stakeAuthority: funder }),
    getAuthorizeInstruction({
      stake: account.address,
      authority: funder,
      arg0: plan.target,
      arg1: StakeAuthorize.Staker,
    }),
  ];
}

/** What is wrong with a created account, read back from the chain; empty when it is what the plan asked for. */
export function problemsWith(plan: DevAccountsPlan, account: PlannedAccount, state: StakeAccount): string[] {
  const problems: string[] = [];
  if (state.staker !== plan.target) problems.push(`staker is ${state.staker}`);
  if (state.withdrawer !== plan.target) problems.push(`withdrawer is ${state.withdrawer}`);
  const { lockup } = state;
  if (lockup.unixTimestamp !== 0n || lockup.epoch !== 0n || lockup.custodian !== ZERO_ADDRESS) {
    problems.push('it has a lockup');
  }
  if (state.lamports !== account.lamports) problems.push(`it holds ${formatSol(state.lamports)}`);
  if (account.kind === 'undelegated' && (state.kind !== 'initialized' || state.delegation !== null)) {
    problems.push('it is delegated');
  }
  if (account.kind === 'delegated') {
    const delegation = state.delegation;
    if (state.kind !== 'delegated' || delegation === null) problems.push('it is not delegated');
    else if (delegation.voter !== plan.voteAccount) problems.push(`it is delegated to ${delegation.voter}`);
    else if (delegation.stake !== account.extra) problems.push(`its stake is ${formatSol(delegation.stake)}`);
    else if (delegation.deactivationEpoch !== U64_MAX) problems.push('it is deactivating');
  }
  return problems;
}

/**
 * Sends one setup transaction per planned account (a blockhash that expires before it lands is replaced, see
 * gate/sender.ts), then reads each account back and checks it. Refuses when the funder holds less than
 * `plan.required`. Throws on the first failure; accounts created before it are logged as they land.
 */
export async function createDevAccounts(
  chain: GateChain,
  funder: KeyPairSigner,
  plan: DevAccountsPlan,
  log: (line: string) => void = () => undefined,
): Promise<{ accounts: CreatedAccount[]; fees: bigint }> {
  if (funder.address !== plan.funder) throw new Error('The plan was made for another funder');
  const balance = await chain.balance(funder.address);
  if (balance < plan.required) throw new DevAccountsRefusal(fundingMessage({ ...plan, balance }));

  const sender = createSender(chain, new Map([[funder.address, 'funder']]), log);
  const accounts: CreatedAccount[] = [];
  for (const account of plan.accounts) {
    const label = `${account.kind} stake account`;
    const { outcome, bytes } = await sender.send(
      label,
      sender.formatted(setupInstructions(plan, account), funder.address, [funder]),
    );
    if (outcome.status !== 'ok') {
      const reason = outcome.status === 'failed' ? describeError(outcome.error, bytes) : 'did not land';
      throw new Error(`Creating the ${label} failed: ${reason} (${explorerUrl('tx', outcome.signature)})`);
    }
    const raw = await chain.account(account.address);
    const decoded = raw === null ? null : decodeStakeAccount(raw);
    if (decoded === null || !decoded.ok) {
      throw new Error(`The ${label} ${account.address} cannot be read back after ${outcome.signature}`);
    }
    const problems = problemsWith(plan, account, decoded.account);
    if (problems.length > 0) {
      throw new Error(`The ${label} ${account.address} is not as planned: ${problems.join('; ')}`);
    }
    log(`created the ${label} ${account.address}`);
    accounts.push({ ...account, signature: outcome.signature, state: decoded.account });
  }
  return { accounts, fees: sender.fees.reduce((sum, entry) => sum + entry.fee, 0n) };
}

export function fundingMessage(plan: Pick<DevAccountsPlan, 'funder' | 'balance' | 'required'>): string {
  return (
    `Not enough SOL: the funder ${plan.funder} holds ${formatSol(plan.balance)}, this needs ` +
    `${formatSol(plan.required)} (${plan.required.toString()} lamports). Fund it at https://faucet.solana.com ` +
    '(devnet) and run again.'
  );
}

function describeAmount(account: PlannedAccount, rentReserve: bigint): string {
  const what = account.kind === 'delegated' ? 'stake' : 'spare';
  return `${formatSol(account.lamports)} (${formatSol(account.extra)} ${what} + ${formatSol(rentReserve)} rent reserve)`;
}

/** The plan as printed before anything is sent (and by --dry-run). */
export function renderPlan(plan: DevAccountsPlan, funderKeyFile: string): string[] {
  const lines = [
    `Devnet stake accounts for ${plan.target}: staker = withdrawer = this address, no lockup.`,
    `  funder       ${plan.funder} (${funderKeyFile}), holds ${formatSol(plan.balance)}`,
  ];
  if (plan.voteAccount !== null) lines.push(`  validator    ${plan.voteAccount}`);
  for (const account of plan.accounts) {
    lines.push(`  ${account.kind.padEnd(12)} ${account.address}  ${describeAmount(account, plan.rentReserve)}`);
  }
  const count = plan.accounts.length;
  lines.push(
    `  network fees ${formatSol(plan.fees)} (${String(count)} transaction${count === 1 ? '' : 's'}, signed by the funder)`,
    `  total cost   ${formatSol(plan.cost)}; the funder also keeps ${formatSol(plan.required - plan.cost)} ` +
      'to stay able to pay fees',
  );
  return lines;
}

/** The result: each account with explorer links, then the total cost. */
export function renderCreated(plan: DevAccountsPlan, accounts: readonly CreatedAccount[], fees: bigint): string[] {
  const lines: string[] = [];
  for (const account of accounts) {
    const delegation = account.state.delegation;
    const detail =
      delegation === null
        ? 'not delegated'
        : `delegated to ${delegation.voter} from epoch ${delegation.activationEpoch.toString()}`;
    lines.push(
      `${account.kind} stake account ${account.address}`,
      `  ${formatSol(account.lamports)}, ${detail}`,
      `  ${explorerUrl('address', account.address)}`,
      `  created by ${explorerUrl('tx', account.signature)}`,
    );
  }
  const held = accounts.reduce((sum, account) => sum + account.lamports, 0n);
  lines.push(
    `Total cost ${formatSol(held + fees)}: ${formatSol(held)} in the accounts, controlled by ${plan.target}, ` +
      `and ${formatSol(fees)} network fees.`,
    `Wallet: ${explorerUrl('address', plan.target)}`,
  );
  return lines;
}
