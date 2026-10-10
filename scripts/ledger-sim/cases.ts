// The transactions the Ledger simulation signs: every kind Stakeward builds, with the Ledger in each role it can
// hold, on a blockhash and on a durable nonce, plus the forms a wallet can turn them into (Phantom's Lighthouse tail).
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  generateKeyPairSigner,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
  type Nonce,
} from '@solana/kit';
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from '@solana-program/compute-budget';
import {
  getAuthorizeCheckedInstruction,
  getDeactivateInstruction,
  getWithdrawInstruction,
  StakeAuthorize,
} from '@solana-program/stake';
import {
  buildTransaction,
  COMPUTE_UNIT_LIMIT,
  COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
  deriveNonceAccountAddress,
  expectedFeePayer,
  NONCE_ACCOUNT_SEED,
  type Lifetime,
  type TransactionAction,
} from '@stakeward/core';
import { appendLighthouseTail } from '@stakeward/core/test/craft';

export type LedgerRole = 'main' | 'second' | 'new' | 'staker' | 'nonce authority';

export type SimCase = {
  id: string;
  title: string;
  /** Which key of the action the Ledger holds. */
  role: LedgerRole;
  lifetime: 'blockhash' | 'nonce';
  /** The wallet change applied before the Ledger signs, if any. */
  variant: 'as built' | 'phantom lighthouse tail' | 'generated layout, no sysvars (control for D1)';
  /** Unsigned wire transaction (signature slots, then the message). */
  bytes: Uint8Array;
};

const random = async () => (await generateKeyPairSigner()).address;

/** Builds every case with `ledger` (the device's address) in its role and throwaway addresses everywhere else. */
export async function buildCases(ledger: Address): Promise<SimCase[]> {
  const stake = await random();
  const vote = await random();
  const other = { main: await random(), second: await random(), new: await random() };
  const blockhash = (await random()) as unknown as Blockhash;
  const nonceValue = (await random()) as unknown as Nonce;

  const keys = (role: LedgerRole) => ({
    main: role === 'main' ? ledger : other.main,
    second: role === 'second' ? ledger : other.second,
    newWallet: role === 'new' ? ledger : other.new,
  });

  type Spec = { id: string; title: string; role: LedgerRole; action: TransactionAction; nonce?: boolean };
  const specs: Spec[] = [];
  const add = (spec: Spec) => specs.push(spec);

  for (const role of ['main', 'second'] as const) {
    const k = keys(role);
    add({ id: `protect-${role}`, title: 'Protect (SetLockupChecked)', role, action: { kind: 'protect', stakeAccount: stake, mainKey: k.main, secondKey: k.second, lockUntil: 1_807_142_400n } });
    add({ id: `withdraw-${role}`, title: 'Withdraw with the second key', role, action: { kind: 'withdraw', stakeAccount: stake, mainKey: k.main, secondKey: k.second, recipient: k.main, lamports: 1_052_282_880n } });
  }
  add({ id: 'extend-second', title: 'Extend (SetLockup)', role: 'second', action: { kind: 'extend', stakeAccount: stake, secondKey: ledger, lockUntil: 1_838_678_400n } });
  add({ id: 'unlock-second', title: 'Unlock early (SetLockup to 0)', role: 'second', action: { kind: 'unlock', stakeAccount: stake, secondKey: ledger } });
  for (const role of ['new', 'main', 'second'] as const) {
    const k = keys(role);
    add({ id: `rescue-${role}`, title: 'Rescue (AuthorizeChecked pair)', role, action: { kind: 'rescue', stakeAccount: stake, mainKey: k.main, secondKey: k.second, newWallet: k.newWallet } });
  }
  add({ id: 'deactivate-staker', title: 'Deactivate', role: 'staker', action: { kind: 'deactivate', stakeAccount: stake, staker: ledger } });
  add({ id: 'delegate-staker', title: 'Delegate', role: 'staker', action: { kind: 'delegate', stakeAccount: stake, staker: ledger, voteAccount: vote } });
  const nonceAccount = await deriveNonceAccountAddress(ledger);
  add({ id: 'nonce-setup', title: 'Create nonce account', role: 'nonce authority', action: { kind: 'nonce-setup', nonceAccount, nonceAuthority: ledger, seed: NONCE_ACCOUNT_SEED, lamports: 1_447_680n } });
  add({ id: 'nonce-close', title: 'Close nonce account', role: 'nonce authority', action: { kind: 'nonce-close', nonceAccount, nonceAuthority: ledger, recipient: ledger, lamports: 1_447_680n } });

  const cases: SimCase[] = [];
  for (const spec of specs) {
    const feePayer = expectedFeePayer(spec.action);
    const lifetimes: Lifetime[] = [{ kind: 'blockhash', blockhash, lastValidBlockHeight: 1n }];
    // Signing by link runs on the fee payer's nonce account (the new wallet's for a rescue); creating it cannot.
    if (spec.action.kind !== 'nonce-setup') {
      lifetimes.push({ kind: 'nonce', nonceAccount: await deriveNonceAccountAddress(feePayer), nonceAuthority: feePayer, nonceValue });
    }
    for (const lifetime of lifetimes) {
      const { bytes } = buildTransaction(spec.action, { feePayer, lifetime });
      const base = { title: spec.title, role: spec.role, lifetime: lifetime.kind };
      cases.push({ ...base, id: `${spec.id}-${lifetime.kind}`, variant: 'as built', bytes });
      // Phantom on mainnet appends Lighthouse assertions before the Ledger signs (DECISIONS D5, D117).
      if (lifetime.kind === 'blockhash' && (spec.action.kind === 'protect' || spec.action.kind === 'rescue' || spec.action.kind === 'withdraw') && spec.role !== 'second') {
        cases.push({ ...base, id: `${spec.id}-${lifetime.kind}-lighthouse`, variant: 'phantom lighthouse tail', bytes: appendLighthouseTail(bytes, [stake]) });
      }
    }
  }
  // Control for DECISIONS D1: the same instructions in the layout @solana-program/stake 0.10.0 emits (no sysvars).
  const signer = createNoopSigner;
  const generated = (id: string, title: string, role: LedgerRole, feePayer: Address, instructions: Instruction[]) => {
    const message = pipe(
      createTransactionMessage({ version: 'legacy' }),
      (m) => setTransactionMessageFeePayer(feePayer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight: 1n }, m),
      (m) =>
        appendTransactionMessageInstructions(
          [
            getSetComputeUnitLimitInstruction({ units: COMPUTE_UNIT_LIMIT }),
            getSetComputeUnitPriceInstruction({ microLamports: COMPUTE_UNIT_PRICE_MICRO_LAMPORTS }),
            ...instructions,
          ],
          m,
        ),
    );
    const bytes = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
    cases.push({ id: `${id}-generated-layout`, title, role, lifetime: 'blockhash', variant: 'generated layout, no sysvars (control for D1)', bytes });
  };
  generated('withdraw-main', 'Withdraw with the second key', 'main', ledger, [
    getWithdrawInstruction({ stake, recipient: ledger, withdrawAuthority: signer(ledger), lockupAuthority: signer(other.second), args: 1_052_282_880n }),
  ]);
  generated('rescue-new', 'Rescue (AuthorizeChecked pair)', 'new', ledger, [
    getAuthorizeCheckedInstruction({ stake, authority: signer(other.main), newAuthority: signer(ledger), stakeAuthorize: StakeAuthorize.Staker }),
    getAuthorizeCheckedInstruction({ stake, authority: signer(other.main), newAuthority: signer(ledger), lockupAuthority: signer(other.second), stakeAuthorize: StakeAuthorize.Withdrawer }),
  ]);
  generated('deactivate-staker', 'Deactivate', 'staker', ledger, [getDeactivateInstruction({ stake, stakeAuthority: signer(ledger) })]);
  return cases;
}
