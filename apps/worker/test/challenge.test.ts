// GET /api/challenge (src/challenge.ts, DECISIONS D132): the devnet challenge wallet's published main key.
import { getAddressDecoder, getBase58Decoder } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { challengeKeypair } from '../src/challenge.ts';
import { fakeUpstream, testApp } from './fakes.ts';

// 64 bytes shaped like a keypair file: 32 bytes of "seed", then 32 bytes read as the public key. Not a real key.
const BYTES = Uint8Array.from({ length: 64 }, (_, i) => i + 1);
const SECRET = getBase58Decoder().decode(BYTES);
const PUBLIC = getAddressDecoder().decode(BYTES.slice(32));

const noUpstream = () =>
  fakeUpstream(() => {
    throw new Error('the challenge route never calls the RPC');
  });

describe('GET /api/challenge', () => {
  it('on devnet returns the main key and its public half, uncached', async () => {
    const app = testApp(noUpstream(), { env: { CLUSTER: 'devnet', CHALLENGE_MAIN_KEY: `${SECRET}\n` } });
    const response = await app.request('/api/challenge');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(await response.json()).toEqual({ mainKey: PUBLIC, mainKeySecret: SECRET });
  });

  it('is 404 on mainnet, even with the secret set', async () => {
    const env = { CLUSTER: 'mainnet', CHALLENGE_MAIN_KEY: SECRET } as unknown as Partial<Env>;
    const response = await testApp(noUpstream(), { env }).request('/api/challenge');
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain(SECRET);
  });

  it('is 503 while the secret is unset or not a keypair', async () => {
    for (const secret of [undefined, '', 'not base58 0OIl', getBase58Decoder().decode(BYTES.slice(32))]) {
      const env: Partial<Env> = secret === undefined ? { CLUSTER: 'devnet' } : { CLUSTER: 'devnet', CHALLENGE_MAIN_KEY: secret };
      const app = testApp(noUpstream(), { env });
      const response = await app.request('/api/challenge');
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: 'challenge-not-configured' });
    }
  });
});

describe('challengeKeypair', () => {
  it('accepts only 64 bytes of base58', () => {
    expect(challengeKeypair(SECRET)).toEqual({ mainKey: PUBLIC, mainKeySecret: SECRET });
    expect(challengeKeypair(getBase58Decoder().decode(BYTES.slice(1)))).toBeNull();
  });
});
