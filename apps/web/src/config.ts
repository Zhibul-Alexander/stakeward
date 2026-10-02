import { SOLANA_DEVNET_CHAIN, SOLANA_MAINNET_CHAIN } from '@solana/wallet-standard-chains';
import type { Cluster } from '@stakeward/core';

/**
 * Build-time settings. The cluster comes from VITE_CLUSTER (vite.config.ts: `devnet` by default for the dev server
 * and tests; `vite build` requires it, see the build:devnet / build:mainnet scripts). It is a setting, not a branch
 * in the code (CLAUDE.md section 3): dev-only pages and lock periods check IS_DEVNET.
 */
export const CLUSTER: Cluster = import.meta.env.VITE_CLUSTER;

/**
 * True only in a devnet build. For runtime checks (devnet badge, lock periods). To keep code OUT of the mainnet
 * bundle, IS_DEVNET is not enough: the bundler does not fold a constant imported from another module. Write the
 * literal comparison `import.meta.env.VITE_CLUSTER === 'devnet'` in the module that holds the dynamic import (see
 * routes.tsx); Vite replaces it with a literal and the dead branch, with its chunk, disappears.
 * test/build-output.test.ts checks this.
 */
export const IS_DEVNET = import.meta.env.VITE_CLUSTER === 'devnet';

/** Wallet Standard chain id for signing requests. */
export const WALLET_CHAIN = IS_DEVNET ? SOLANA_DEVNET_CHAIN : SOLANA_MAINNET_CHAIN;

export const SOURCE_CODE_URL = 'https://github.com/Zhibul-Alexander/stakeward';

/** Path of the landing-page section linked from every footer (UX rule 12). */
export const CANNOT_DO_PATH = '/#cannot-do';

const EXPLORER_ORIGIN = 'https://explorer.solana.com';

/** Solana Explorer link for an address (account, wallet) or a transaction signature on the current cluster. */
export function explorerUrl(kind: 'address' | 'tx', value: string, cluster: Cluster = CLUSTER): string {
  const url = new URL(`/${kind}/${encodeURIComponent(value)}`, EXPLORER_ORIGIN);
  if (cluster === 'devnet') url.searchParams.set('cluster', 'devnet');
  return url.toString();
}
