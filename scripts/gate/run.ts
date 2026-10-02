// The mechanism gate (CLAUDE.md step 1): the lockup rules Stakeward relies on, checked against the real stake
// program on LiteSVM, devnet or mainnet. Every check transaction that the product also sends is built by core's
// buildTransaction, so the gate proves the exact bytes the product will send.
import {
  createAddressWithSeed,
  createNoopSigner,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type Nonce,
} from '@solana/kit';
import {
  getAuthorizeCheckedInstruction,
  getInitializeInstruction,
  getMergeInstruction,
  getSplitInstruction,
  StakeAuthorize,
  StakeInstruction,
} from '@solana-program/stake';
import {
  getCreateAccountWithSeedInstruction,
  getNonceDecoder,
  getTransferSolInstruction,
} from '@solana-program/system';
import {
  buildTransaction,
  cosignFragment,
  decodeStakeAccount,
  deriveNonceAccountAddress,
  LEGACY_SYSVAR_SLOTS,
  NONCE_ACCOUNT_SEED,
  parseCosignFragment,
  STAKE_ACCOUNT_SIZE,
  STAKE_PROGRAM_ADDRESS,
  toLegacyLayout,
  ZERO_ADDRESS,
  type ClockView,
  type Lockup,
  type NonceLifetime,
  type StakeAccount,
} from '@stakeward/core';
import { STAKE_PROGRAM_SHA256 } from '@stakeward/core/test/support';
import { testWallet } from '@stakeward/core/test/wallet';
import {
  gateBudget,
  MIN_DELEGATION_LAMPORTS,
  PARTIAL_WITHDRAW_LAMPORTS,
  readRents,
  SPLIT_LAMPORTS,
  type Budget,
  type Role,
} from './budget.ts';
import type { GateChain, GateCluster, ProgramElf, TxOutcome } from './chain.ts';
import { checksFor, describeError, outcomeMatches, type Expectation } from './checks.ts';
import { createSender, type Built, type FeeEntry } from './sender.ts';
import { sweep, type SweepResult } from './sweep.ts';
import { formatSol } from './tx.ts';

const HOUR = 3_600n;
const NO_LOCKUP: Lockup = { unixTimestamp: 0n, epoch: 0n, custodian: ZERO_ADDRESS };

/** On mainnet the one-time key is both `funder` and `A`. */
export type GateKeys = Readonly<Record<Role, KeyPairSigner>>;

export type GateOptions = {
  cluster: GateCluster;
  keys: GateKeys;
  /** Makes the seeds of this run's accounts unique (devnet and mainnet keep the funder between runs). */
  runId?: string;
  log?: (line: string) => void;
};

export type CheckResult = {
  id: string;
  title: string;
  expected: Expectation;
  /** null: not run, because the gate stopped earlier. */
  outcome: TxOutcome | null;
  /** The error of a failed transaction in readable form. */
  failure: string | null;
  matched: boolean;
  /** What was verified on chain after the transaction, or why the check did not match. */
  note: string | null;
};

export type GateReport = {
  cluster: GateCluster;
  startedAt: Date;
  clockAtStart: ClockView;
  program: ProgramElf;
  /** The deployed (or loaded) ELF is byte-identical to the stake program release committed as a test fixture. */
  programMatchesRelease: boolean;
  keys: Readonly<Record<Role, Address>>;
  voteAccount: Address | null;
  budget: Budget;
  results: CheckResult[];
  /** Why the gate stopped before the last check, or null. */
  aborted: string | null;
  fees: FeeEntry[];
  sweep: SweepResult | null;
};

class GateAbort extends Error {}

type Verdict = { ok: boolean; note: string };

export async function runGate(chain: GateChain, options: GateOptions): Promise<GateReport> {
  const { cluster, keys } = options;
  const { funder, A, B, X, D } = keys;
  const full = cluster !== 'mainnet';
  const log = options.log ?? (() => undefined);
  const runId = options.runId ?? Date.now().toString(36);
  // Later entries win: on mainnet the funder is A.
  const roles = new Map<Address, Role>([
    [funder.address, 'funder'],
    [A.address, 'A'],
    [B.address, 'B'],
    [X.address, 'X'],
    [D.address, 'D'],
  ]);
  const sender = createSender(chain, roles, log);

  const startedAt = new Date();
  const clockAtStart = await chain.clock();
  const program = await chain.programElf();
  const rents = await readRents(chain);
  const budget = gateBudget(cluster, rents);
  const results: CheckResult[] = checksFor(cluster).map((spec) => ({
    ...spec,
    outcome: null,
    failure: null,
    matched: false,
    note: null,
  }));
  let voteAccount: Address | null = null;
  let aborted: string | null = null;
  /** Accounts this run created, by name, for the sweep notes. */
  const names = new Map<Address, string>();

  const name = (address: Address) => roles.get(address) ?? `${address.slice(0, 4)}…${address.slice(-4)}`;
  const describeLockup = ({ unixTimestamp, epoch, custodian }: Lockup) =>
    custodian === ZERO_ADDRESS && unixTimestamp === 0n && epoch === 0n
      ? 'без замка'
      : `unix_timestamp = ${unixTimestamp === 0n ? '0' : formatTime(unixTimestamp)}, хранитель ${name(custodian)}`;

  async function stake(address: Address): Promise<StakeAccount | null> {
    const raw = await chain.account(address);
    if (raw === null) return null;
    const decoded = decodeStakeAccount(raw);
    if (!decoded.ok) throw new Error(`${address} is not a stake account: ${decoded.error}`);
    return decoded.account;
  }

  async function lockupIs(address: Address, expected: Lockup): Promise<Verdict> {
    const lockup = (await stake(address))?.lockup;
    const ok =
      lockup !== undefined &&
      lockup.unixTimestamp === expected.unixTimestamp &&
      lockup.epoch === expected.epoch &&
      lockup.custodian === expected.custodian;
    return { ok, note: lockup === undefined ? 'аккаунт не найден' : describeLockup(lockup) };
  }

  async function authoritiesAre(address: Address, staker: Address, withdrawer: Address, lockup: Lockup): Promise<Verdict> {
    const account = await stake(address);
    const lockupCheck = await lockupIs(address, lockup);
    const ok = account?.staker === staker && account.withdrawer === withdrawer && lockupCheck.ok;
    const note =
      account === null
        ? 'аккаунт не найден'
        : `staker ${name(account.staker)}, withdrawer ${name(account.withdrawer)}, ${lockupCheck.note}`;
    return { ok, note };
  }

  async function closed(address: Address): Promise<Verdict> {
    const ok = (await chain.account(address)) === null;
    return { ok, note: ok ? 'аккаунт закрыт, всё выведено' : 'аккаунт не закрыт' };
  }

  /** Sends one check transaction, matches the outcome, then (if it matched) verifies the state on chain. */
  async function check(id: string, make: () => Promise<Built>, verify?: () => Promise<Verdict>): Promise<boolean> {
    const result = results.find((row) => row.id === id);
    if (result === undefined) throw new Error(`Check ${id} is not planned for ${cluster}`);
    const { outcome, bytes } = await sender.send(id, make);
    result.outcome = outcome;
    result.failure =
      outcome.status === 'failed'
        ? describeError(outcome.error, bytes)
        : outcome.status === 'dropped'
          ? 'транзакция не попала в блок'
          : null;
    result.matched = outcomeMatches(result.expected, outcome, bytes);
    if (result.matched && verify !== undefined) {
      const verdict = await verify();
      result.matched = verdict.ok;
      result.note = verdict.ok ? verdict.note : `состояние не то: ${verdict.note}`;
    }
    const failure = result.failure === null ? '' : ` (${result.failure})`;
    log(`${result.matched ? 'ok  ' : 'FAIL'} ${id.padEnd(3)} ${outcome.status}${failure}`);
    return result.matched;
  }

  async function setup(label: string, instructions: readonly Instruction[], signers: readonly KeyPairSigner[] = []) {
    const { outcome, bytes } = await sender.send(label, sender.formatted(instructions, funder.address, [funder, ...signers]));
    if (outcome.status !== 'ok') {
      const reason = outcome.status === 'failed' ? describeError(outcome.error, bytes) : 'не попала в блок';
      throw new GateAbort(`Подготовка «${label}» не прошла: ${reason}`);
    }
  }

  /** A stake account address derived from the funder (CreateAccountWithSeed), so no throwaway keypair is needed. */
  async function newStakeAccount(
    label: string,
    lamports: bigint,
    init: { staker: Address; withdrawer: Address; lockup: Lockup } | null,
  ) {
    const seed = `g${runId}${label.toLowerCase()}`;
    const address = await createAddressWithSeed({
      baseAddress: funder.address,
      programAddress: STAKE_PROGRAM_ADDRESS,
      seed,
    });
    names.set(address, label);
    const instructions: Instruction[] = [
      getCreateAccountWithSeedInstruction({
        payer: createNoopSigner(funder.address),
        newAccount: address,
        base: funder.address,
        seed,
        amount: lamports,
        space: STAKE_ACCOUNT_SIZE,
        programAddress: STAKE_PROGRAM_ADDRESS,
      }),
    ];
    if (init !== null) {
      instructions.push(
        getInitializeInstruction({
          stake: address,
          arg0: { staker: init.staker, withdrawer: init.withdrawer },
          arg1: init.lockup,
        }),
      );
    }
    return { address, instructions };
  }

  /** The thief's AuthorizeChecked (no product builder makes it), in the legacy layout like the product's rescue. */
  function authorizeChecked(stakeAccount: Address, newAuthority: Address, kind: StakeAuthorize): Instruction {
    const slot = LEGACY_SYSVAR_SLOTS[StakeInstruction.AuthorizeChecked];
    if (slot === undefined) throw new Error('No legacy layout for AuthorizeChecked');
    return toLegacyLayout(
      getAuthorizeCheckedInstruction({
        stake: stakeAccount,
        authority: createNoopSigner(A.address),
        newAuthority: createNoopSigner(newAuthority),
        stakeAuthorize: kind,
      }),
      slot,
    );
  }

  const now = async () => (await chain.clock()).unixTimestamp;
  const lockedByB = (unixTimestamp: bigint): Lockup => ({ unixTimestamp, epoch: 0n, custodian: B.address });
  const unlockedByB: Lockup = { unixTimestamp: 0n, epoch: 0n, custodian: B.address };

  /** Withdraw signed by A (and B as custodian when given) to A: the whole balance unless `lamports` is given. */
  const withdrawByA =
    (stakeAccount: Address, custodian: KeyPairSigner | null, lamports?: bigint) => async (): Promise<Built> => {
      const action = {
        kind: 'withdraw',
        stakeAccount,
        mainKey: A.address,
        secondKey: custodian?.address ?? null,
        recipient: A.address,
        lamports: lamports ?? (await chain.balance(stakeAccount)),
      } as const;
      return sender.product(action, custodian === null ? [A] : [A, custodian])();
    };
  /** The thief's transaction: one AuthorizeChecked signed by A and X, paid by A. */
  const thief = (stakeAccount: Address, kind: StakeAuthorize) =>
    sender.formatted([authorizeChecked(stakeAccount, X.address, kind)], A.address, [A, X]);
  const asX = createNoopSigner(X.address);

  try {
    if (full) {
      const floats = (['A', 'B', 'D'] as const).map((role) =>
        getTransferSolInstruction({
          source: createNoopSigner(funder.address),
          destination: keys[role].address,
          amount: budget.floats[role] ?? 0n,
        }),
      );
      await setup('fund A, B, D', floats);
    }

    // 1. S1: staker = withdrawer = A, no lockup; delegated, except on mainnet.
    const s1Lamports = rents.stake + (full ? MIN_DELEGATION_LAMPORTS : 0n);
    const S1 = await newStakeAccount('S1', s1Lamports, { staker: A.address, withdrawer: A.address, lockup: NO_LOCKUP });
    const created = await check('1a', sender.formatted(S1.instructions, funder.address, [funder]), async () => {
      const verdict = await authoritiesAre(S1.address, A.address, A.address, NO_LOCKUP);
      return { ...verdict, note: `${formatSol(s1Lamports)}, ${verdict.note}` };
    });
    if (!created) throw new GateAbort('Не удалось создать S1');
    if (full) {
      const vote = await chain.voteAccount();
      voteAccount = vote;
      const delegate = { kind: 'delegate', stakeAccount: S1.address, staker: A.address, voteAccount: vote } as const;
      const delegated = await check('1b', sender.product(delegate, [A]), async () => {
        const delegation = (await stake(S1.address))?.delegation;
        const epoch = (await chain.clock()).epoch;
        return {
          ok: delegation?.voter === vote && delegation.activationEpoch === epoch,
          note: `делегирован ${vote} в эпохе ${String(epoch)}`,
        };
      });
      if (!delegated) throw new GateAbort('Не удалось делегировать S1');
    }

    // 2. The main assertion: the withdrawer and a new custodian lock an existing account.
    const T1 = (await now()) + HOUR;
    const protect = {
      kind: 'protect',
      stakeAccount: S1.address,
      mainKey: A.address,
      secondKey: B.address,
      lockUntil: T1,
    } as const;
    if (!(await check('2', sender.product(protect, [A, B]), () => lockupIs(S1.address, lockedByB(T1))))) {
      throw new GateAbort('Проверка 2, главное утверждение, не совпала с ожиданием. Остановлено (CLAUDE.md, шаг 1).');
    }

    // 3-5. The main key alone can neither withdraw, nor take the withdrawer role, nor lift the lock.
    const s1Balance = await chain.balance(S1.address);
    await check('3', withdrawByA(S1.address, null), async () => ({
      ok: (await chain.balance(S1.address)) === s1Balance,
      note: 'баланс S1 не изменился',
    }));
    await check('4', thief(S1.address, StakeAuthorize.Withdrawer), () =>
      authoritiesAre(S1.address, A.address, A.address, lockedByB(T1)),
    );
    await check('5', sender.product({ kind: 'unlock', stakeAccount: S1.address, secondKey: A.address }, [A]), () =>
      lockupIs(S1.address, lockedByB(T1)),
    );

    // 6. The custodian alone extends the lock (on mainnet A pays, as in F5 when K has no SOL).
    const T2 = (await now()) + 2n * HOUR;
    const extend = { kind: 'extend', stakeAccount: S1.address, secondKey: B.address, lockUntil: T2 } as const;
    await check('6', sender.product(extend, [A, B], full ? undefined : A.address), () =>
      lockupIs(S1.address, lockedByB(T2)),
    );

    if (!full) {
      // 13 on mainnet: the custodian lifts the lock (A pays), then the main key alone withdraws everything back.
      const unlock = { kind: 'unlock', stakeAccount: S1.address, secondKey: B.address } as const;
      await check('13a', sender.product(unlock, [A, B], A.address), () => lockupIs(S1.address, unlockedByB));
      await check('13b', withdrawByA(S1.address, null), () => closed(S1.address));
    } else {
      // 7. What a thief with only A can do. Deactivating in the activation epoch leaves S1 fully inactive at once,
      // so Split and Merge below see an inactive account and no warmup or cooldown is involved.
      const deactivate = { kind: 'deactivate', stakeAccount: S1.address, staker: A.address } as const;
      await check('7a', sender.product(deactivate, [A]), async () => {
        const delegation = (await stake(S1.address))?.delegation;
        const epoch = (await chain.clock()).epoch;
        return { ok: delegation?.deactivationEpoch === epoch, note: `deactivation_epoch = ${String(epoch)}` };
      });
      await check('7b', thief(S1.address, StakeAuthorize.Staker), () =>
        authoritiesAre(S1.address, X.address, A.address, lockedByB(T2)),
      );

      // 8. Split copies authorities and lockup; the new account is just as locked.
      const S2 = await newStakeAccount('S2', rents.stake, null);
      await setup('create S2 (split target)', S2.instructions);
      const split = getSplitInstruction({
        stake: S1.address,
        splitStake: S2.address,
        stakeAuthority: asX,
        args: SPLIT_LAMPORTS,
      });
      await check('8a', sender.formatted([split], A.address, [A, X]), () =>
        authoritiesAre(S2.address, X.address, A.address, lockedByB(T2)),
      );
      await check('8b', withdrawByA(S2.address, null));

      // 9. Merge into a locked account needs the same lockup.
      const Sm = await newStakeAccount('Sm', rents.stake, { staker: X.address, withdrawer: A.address, lockup: NO_LOCKUP });
      await setup('create Sm (unlocked, staker X, withdrawer A)', Sm.instructions);
      const merge = getMergeInstruction({ destinationStake: S1.address, sourceStake: Sm.address, stakeAuthority: asX });
      await check('9', sender.formatted([merge], A.address, [A, X]), async () => ({
        ok: (await chain.account(Sm.address)) !== null,
        note: 'Sm на месте',
      }));

      // 10. Both keys withdraw from a locked account.
      const s2Before = await chain.balance(S2.address);
      await check('10', withdrawByA(S2.address, B, PARTIAL_WITHDRAW_LAMPORTS), async () => {
        const after = await chain.balance(S2.address);
        return { ok: after === s2Before - PARTIAL_WITHDRAW_LAMPORTS, note: `на S2 осталось ${formatSol(after)}` };
      });

      // 11. Rescue after the thief moved the staker: both authorities to D, D pays; the lockup stays.
      const rescue = {
        kind: 'rescue',
        stakeAccount: S1.address,
        mainKey: A.address,
        secondKey: B.address,
        newWallet: D.address,
      } as const;
      await check('11a', sender.product(rescue, [D, A, B]), () =>
        authoritiesAre(S1.address, D.address, D.address, lockedByB(T2)),
      );
      await check('11b', withdrawByA(S1.address, B));
      await check('11c', thief(S1.address, StakeAuthorize.Staker));

      // 12. The same rescue on a durable nonce owned by D, signed one wallet at a time through /cosign links.
      const T3 = (await now()) + 2n * HOUR;
      const S3 = await newStakeAccount('S3', rents.stake, { staker: A.address, withdrawer: A.address, lockup: lockedByB(T3) });
      await setup('create S3 (locked by B)', S3.instructions);
      const nonceAccount = await deriveNonceAccountAddress(D.address);
      names.set(nonceAccount, 'nonce D');
      const nonceSetup = {
        kind: 'nonce-setup',
        nonceAccount,
        nonceAuthority: D.address,
        seed: NONCE_ACCOUNT_SEED,
        lamports: rents.nonce,
      } as const;
      const nonceCreated = await check('12a', sender.product(nonceSetup, [D]), async () => {
        const nonce = await readNonce(chain, nonceAccount);
        return { ok: nonce?.authority === D.address, note: `nonce-аккаунт ${nonceAccount}, authority D` };
      });
      if (nonceCreated) {
        const nonceValue = (await readNonce(chain, nonceAccount))?.value;
        if (nonceValue === undefined) throw new GateAbort('nonce-аккаунт не читается');
        const lifetime: NonceLifetime = { kind: 'nonce', nonceAccount, nonceAuthority: D.address, nonceValue };
        let linkLength = 0;
        const signOneByOne = async (): Promise<Built> => {
          const built = buildTransaction({ ...rescue, stakeAccount: S3.address }, { feePayer: D.address, lifetime });
          let link = cosignFragment(built.bytes);
          for (const signer of [D, A, B]) {
            const unsigned = parseCosignFragment(link);
            if (unsigned === null) throw new Error('The /cosign link did not parse');
            const [signed] = await testWallet(signer).signTransactions([unsigned]);
            if (signed === undefined) throw new Error('The test wallet returned nothing');
            link = cosignFragment(signed);
          }
          linkLength = link.length;
          const bytes = parseCosignFragment(link);
          if (bytes === null) throw new Error('The /cosign link did not parse');
          return { bytes, lifetime };
        };
        await check('12b', signOneByOne, async () => {
          const verdict = await authoritiesAre(S3.address, D.address, D.address, lockedByB(T3));
          const advanced = (await readNonce(chain, nonceAccount))?.value !== nonceValue;
          return {
            ok: verdict.ok && advanced,
            note: `${verdict.note}; nonce сдвинут: ${advanced ? 'да' : 'нет'}; ссылка /cosign ${String(linkLength)} символов`,
          };
        });
        const nonceClose = async (): Promise<Built> => {
          const lamports = await chain.balance(nonceAccount);
          const action = { kind: 'nonce-close', nonceAccount, nonceAuthority: D.address, recipient: D.address, lamports };
          return sender.product({ ...action, kind: 'nonce-close' }, [D])();
        };
        await check('12c', nonceClose, () => closed(nonceAccount));
      }

      // 13. The custodian lifts the lock early; then the main key alone withdraws.
      await check('13a', sender.product({ kind: 'unlock', stakeAccount: S2.address, secondKey: B.address }, [B]), () =>
        lockupIs(S2.address, unlockedByB),
      );
      await check('13b', withdrawByA(S2.address, null), () => closed(S2.address));

      // 14. LiteSVM only: after T the main key alone owns the account again.
      if (cluster === 'litesvm') {
        const { setTime } = chain;
        if (setTime === undefined) throw new Error('Check 14 needs a chain whose clock can be moved');
        const T4 = (await now()) + HOUR;
        const S4 = await newStakeAccount('S4', rents.stake, { staker: A.address, withdrawer: A.address, lockup: lockedByB(T4) });
        await setup('create S4 (locked by B)', S4.instructions);
        await check('14a', withdrawByA(S4.address, null));
        setTime(T4 + 1n);
        await check('14b', sender.product({ kind: 'unlock', stakeAccount: S4.address, secondKey: A.address }, [A]), () =>
          lockupIs(S4.address, unlockedByB),
        );
        await check('14c', withdrawByA(S4.address, null), () => closed(S4.address));
      }
    }
  } catch (error) {
    aborted = error instanceof Error ? error.message : String(error);
    log(`stopped: ${aborted}`);
  }

  let sweepResult: SweepResult;
  try {
    sweepResult = await sweep(sender, funder, full ? [A, B, X, D] : [A, B, X], names);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    sweepResult = { notes: [`возврат средств прервался: ${reason}`], clean: false };
  }

  return {
    cluster,
    startedAt,
    clockAtStart,
    program,
    programMatchesRelease: program.sha256 === STAKE_PROGRAM_SHA256,
    keys: { funder: funder.address, A: A.address, B: B.address, X: X.address, D: D.address },
    voteAccount,
    budget,
    results,
    aborted,
    fees: sender.fees,
    sweep: sweepResult,
  };
}

/** The durable nonce stored in a nonce account, and its authority. */
async function readNonce(chain: GateChain, nonceAccount: Address): Promise<{ value: Nonce; authority: Address } | null> {
  const raw = await chain.account(nonceAccount);
  if (raw === null) return null;
  const nonce = getNonceDecoder().decode(raw.data);
  return { value: nonce.blockhash as string as Nonce, authority: nonce.authority };
}

/** `1790816400n` -> `2026-10-01 01:00:00 UTC`. */
export function formatTime(unixTimestamp: bigint): string {
  return `${new Date(Number(unixTimestamp) * 1000).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}
