// Returns everything the gate's keys control to the funder: withdrawable stake accounts, nonce accounts, wallet
// balances. Runs at the end of every devnet and LiteSVM run, and at the start of a run with the keys of the previous
// one (recovery after a crash). Best effort: what cannot be returned yet is listed in the notes.
import { createNoopSigner, type Address, type KeyPairSigner } from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { decodeStakeAccount, deriveNonceAccountAddress, isLockupInForce, stakeActivationStatus } from '@stakeward/core';
import type { Sender } from './sender.ts';
import { formatSol } from './tx.ts';

export type SweepResult = {
  /** What was returned and what is left, one line each (Russian, for docs/gate.md). */
  notes: string[];
  /** True when the keys hold nothing any more. */
  clean: boolean;
};

/**
 * `payer` pays every fee and receives everything. `keys` are the role keys to empty: stake accounts whose withdrawer
 * is one of them are withdrawn (the payer's own stake accounts only when it is listed, as the mainnet one-time key
 * is), nonce accounts they own are closed, their balances go to the payer. `names` labels known accounts in the notes.
 */
export async function sweep(
  sender: Sender,
  payer: KeyPairSigner,
  keys: readonly KeyPairSigner[],
  names: ReadonlyMap<Address, string> = new Map(),
): Promise<SweepResult> {
  const { chain } = sender;
  const label = (address: Address) => {
    const known = names.get(address);
    return known === undefined ? `\`${address}\`` : `${known} \`${address}\``;
  };
  const sink = payer.address;
  const byAddress = new Map([payer, ...keys].map((key) => [key.address, key]));
  const owners = keys.filter((key) => key.address !== sink);
  const notes: string[] = [];
  const clock = await chain.clock();

  for (const owner of keys) {
    for (const stakeAccount of await chain.stakeAccountsOf(owner.address)) {
      const raw = await chain.account(stakeAccount);
      if (raw === null) continue;
      const decoded = decodeStakeAccount(raw);
      if (!decoded.ok) {
        notes.push(`${label(stakeAccount)}: не разобран (${decoded.error}), оставлен`);
        continue;
      }
      const { delegation, lockup, staker } = decoded.account;
      const status = stakeActivationStatus(delegation, clock.epoch);
      if (status !== 'inactive') {
        const stakerKey = byAddress.get(staker);
        if ((status === 'active' || status === 'activating') && stakerKey !== undefined) {
          const action = { kind: 'deactivate', stakeAccount, staker } as const;
          const { outcome } = await sender.send('sweep: deactivate', sender.product(action, [payer, stakerKey], sink));
          notes.push(`${label(stakeAccount)}: был ${status}, Deactivate: ${outcome.status}; вывести после конца эпохи`);
        } else {
          notes.push(`${label(stakeAccount)}: ${status}, вывести после конца эпохи`);
        }
        continue;
      }
      const locked = isLockupInForce(lockup, clock);
      const custodian = locked ? byAddress.get(lockup.custodian) : undefined;
      if (locked && (custodian === undefined || custodian.address === owner.address)) {
        notes.push(`${label(stakeAccount)}: заперт хранителем \`${lockup.custodian}\`, без его подписи не вывести`);
        continue;
      }
      const action = {
        kind: 'withdraw',
        stakeAccount,
        mainKey: owner.address,
        secondKey: custodian?.address ?? null,
        recipient: sink,
        lamports: raw.lamports,
      } as const;
      const signers = custodian === undefined ? [payer, owner] : [payer, owner, custodian];
      const { outcome } = await sender.send('sweep: withdraw', sender.product(action, signers, sink));
      notes.push(`${label(stakeAccount)}: Withdraw ${formatSol(raw.lamports)} плательщику: ${outcome.status}`);
    }
  }

  for (const owner of owners) {
    const nonceAccount = await deriveNonceAccountAddress(owner.address);
    const raw = await chain.account(nonceAccount);
    if (raw === null) continue;
    const action = {
      kind: 'nonce-close',
      nonceAccount,
      nonceAuthority: owner.address,
      recipient: sink,
      lamports: raw.lamports,
    } as const;
    const { outcome } = await sender.send('sweep: nonce close', sender.product(action, [payer, owner], sink));
    notes.push(`nonce-аккаунт ${label(nonceAccount)}: закрыт, ${formatSol(raw.lamports)} плательщику: ${outcome.status}`);
  }

  const holders: { key: KeyPairSigner; lamports: bigint }[] = [];
  for (const key of owners) {
    const lamports = await chain.balance(key.address);
    if (lamports > 0n) holders.push({ key, lamports });
  }
  if (holders.length > 0) {
    const transfers = holders.map(({ key, lamports }) =>
      getTransferSolInstruction({ source: createNoopSigner(key.address), destination: sink, amount: lamports }),
    );
    const signers = [payer, ...holders.map(({ key }) => key)];
    const { outcome } = await sender.send('sweep: transfer', sender.formatted(transfers, sink, signers));
    const total = holders.reduce((sum, { lamports }) => sum + lamports, 0n);
    notes.push(`остатки ключей ролей (${formatSol(total)}) переведены плательщику: ${outcome.status}`);
  }

  return { notes, clean: await isEmpty(sender, keys, owners) };
}

/**
 * True when no key in `withdrawers` is the withdrawer of a stake account and no key in `wallets` holds lamports or a
 * nonce account.
 */
async function isEmpty(
  sender: Sender,
  withdrawers: readonly KeyPairSigner[],
  wallets: readonly KeyPairSigner[],
): Promise<boolean> {
  const { chain } = sender;
  for (const key of withdrawers) {
    if ((await chain.stakeAccountsOf(key.address)).length > 0) return false;
  }
  for (const key of wallets) {
    if ((await chain.balance(key.address)) > 0n) return false;
    if ((await chain.account(await deriveNonceAccountAddress(key.address))) !== null) return false;
  }
  return true;
}
