// Test-only: a decoded StakeAccount back as the 200 bytes the chain stores (CLAUDE.md section 4 layout), for stub
// chains that answer getAccounts. Every encoding is decoded again with core and must give the same account, so a
// mistake here fails loudly instead of feeding a page wrong data.
import { getAddressEncoder } from '@solana/kit';
import { decodeStakeAccount, STAKE_ACCOUNT_SIZE, STAKE_PROGRAM_ADDRESS, type RawAccount, type StakeAccount } from '@stakeward/core';

const addressEncoder = getAddressEncoder();

/** Initialized (no delegation) or Stake (with one); the deprecated warmup rate is 0.25 as on chain. */
export function rawStakeAccount(account: StakeAccount): RawAccount {
  const data = new Uint8Array(STAKE_ACCOUNT_SIZE);
  const view = new DataView(data.buffer);
  view.setUint32(0, account.delegation === null ? 1 : 2, true);
  view.setBigUint64(4, account.rentExemptReserve, true);
  data.set(addressEncoder.encode(account.staker), 12);
  data.set(addressEncoder.encode(account.withdrawer), 44);
  view.setBigInt64(76, account.lockup.unixTimestamp, true);
  view.setBigUint64(84, account.lockup.epoch, true);
  data.set(addressEncoder.encode(account.lockup.custodian), 92);
  const { delegation } = account;
  if (delegation !== null) {
    data.set(addressEncoder.encode(delegation.voter), 124);
    view.setBigUint64(156, delegation.stake, true);
    view.setBigUint64(164, delegation.activationEpoch, true);
    view.setBigUint64(172, delegation.deactivationEpoch, true);
    view.setFloat64(180, 0.25, true);
  }
  const raw: RawAccount = { address: account.address, data, lamports: account.lamports, owner: STAKE_PROGRAM_ADDRESS };
  const decoded = decodeStakeAccount(raw);
  if (!decoded.ok || fields(decoded.account) !== fields(account)) {
    throw new Error(`rawStakeAccount: ${account.address} does not decode back to itself`);
  }
  return raw;
}

/** Every field of the account in a fixed order. */
function fields(a: StakeAccount): string {
  const { lockup: l, delegation: d } = a;
  const delegation = d === null ? ['no delegation'] : [d.voter, d.stake, d.activationEpoch, d.deactivationEpoch];
  return [a.address, a.lamports, a.kind, a.rentExemptReserve, a.staker, a.withdrawer, l.unixTimestamp, l.epoch, l.custodian, ...delegation]
    .map(String)
    .join('|');
}
