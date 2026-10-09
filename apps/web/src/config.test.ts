import { describe, expect, it } from 'vitest';
import { CLUSTER, explorerUrl, GATE_RESULTS_URL, IS_DEVNET, README_RECOVERY_URL, SOURCE_CODE_URL, WALLET_CHAIN } from './config.ts';

describe('config', () => {
  it('defaults to devnet outside `vite build` (dev server and tests)', () => {
    expect(CLUSTER).toBe('devnet');
    expect(IS_DEVNET).toBe(true);
    expect(WALLET_CHAIN).toBe('solana:devnet');
  });

  it('builds Solana Explorer links for each cluster', () => {
    const address = '7xKTg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgA9fQ';
    expect(explorerUrl('address', address, 'devnet')).toBe(`https://explorer.solana.com/address/${address}?cluster=devnet`);
    expect(explorerUrl('address', address, 'mainnet')).toBe(`https://explorer.solana.com/address/${address}`);
    expect(explorerUrl('tx', 'sig/../x', 'mainnet')).toBe('https://explorer.solana.com/tx/sig%2F..%2Fx');
  });

  it('links the README recovery section and the gate results in the repository (landing page)', () => {
    // GitHub's anchor for the README heading "## Recover without Stakeward".
    expect(README_RECOVERY_URL).toBe(`${SOURCE_CODE_URL}#recover-without-stakeward`);
    expect(GATE_RESULTS_URL).toBe('https://github.com/Zhibul-Alexander/stakeward/blob/main/docs/gate.md');
  });
});
