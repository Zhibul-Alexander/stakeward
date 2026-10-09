import type { Address } from '@solana/kit';
import type { WalletPort, WalletRequestOptions } from '@stakeward/core';

/**
 * Connects `wallet` until it offers what the caller needs, asking at most twice (DECISIONS.md D109).
 *
 * Phantom keeps a site on the account it connected first: when the user switches accounts in Phantom, the site gets no
 * change and connect() answers with the old account again, so "switch, then Continue" led nowhere and only a page
 * reload helped (owner's wallet test, 08.10.2026). When the first answer lacks what the caller needs, the site
 * disconnects and connects once more: the wallet then offers the account selected in it now, as after a reload. A
 * wallet that offers a fitting account at once is never disconnected.
 *
 * Returns the accounts offered at the end; the caller decides what a miss means (ask to switch, say still not offered).
 * A declined connect rejects, as wallet.connect does.
 */
export async function connectOffering(
  wallet: WalletPort,
  fits: (accounts: readonly Address[]) => boolean,
  options: WalletRequestOptions = {},
): Promise<readonly Address[]> {
  const first = await wallet.connect(options);
  if (fits(first) || options.signal?.aborted === true) return first;
  await wallet.disconnect();
  return wallet.connect(options);
}
