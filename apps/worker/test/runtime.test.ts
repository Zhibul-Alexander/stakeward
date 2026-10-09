import { getBase64Encoder, getBase58Decoder } from '@solana/kit';
import { describe, expect, it } from 'vitest';

describe('runtime: @solana/kit runs on its workerd build, as in the production bundle', () => {
  it('kit base64 (node build: Buffer) works because nodejs_compat is on', () => {
    expect([...getBase64Encoder().encode('AQID')]).toEqual([1, 2, 3]);
  });

  it('Ed25519 is available to kit through crypto.subtle', async () => {
    const { generateKeyPairSigner } = await import('@solana/kit');
    const signer = await generateKeyPairSigner();
    expect(getBase58Decoder().decode(new Uint8Array(32)).length).toBeGreaterThan(0);
    expect(signer.address.length).toBeGreaterThanOrEqual(32);
  });
});
