import { decodeStakeAccount, type ChainPort, type StakeAccount } from '@stakeward/core';

/**
 * The current state of `accounts`, read again with getAccounts (getMultipleAccounts). The stake account search
 * (findStakeAccounts, /api/stake-accounts) is cached for 30 s at the edge, so it only says which accounts exist; what
 * they look like now comes from this read (CLAUDE.md section 12: the truth is on chain). Each address is read once, in
 * the order given; an account that no longer exists or no longer decodes as a stake account is left out. No account,
 * no read.
 */
export async function refreshStakeAccounts(chain: ChainPort, accounts: readonly StakeAccount[]): Promise<StakeAccount[]> {
  const addresses = [...new Set(accounts.map((account) => account.address))];
  if (addresses.length === 0) return [];
  const read = await chain.getAccounts(addresses);
  const fresh: StakeAccount[] = [];
  addresses.forEach((address, index) => {
    const raw = read.accounts[index];
    if (raw === null || raw === undefined || raw.address !== address) return;
    const decoded = decodeStakeAccount(raw);
    if (decoded.ok) fresh.push(decoded.account);
  });
  return fresh;
}
