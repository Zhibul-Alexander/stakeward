import { describe, expect, it } from 'vitest';
import { CLUSTER, explorerUrl, IS_DEVNET, WALLET_CHAIN } from './config.ts';

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
});
