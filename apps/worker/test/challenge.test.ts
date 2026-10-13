// GET /api/challenge (src/challenge.ts, DECISIONS D133, D154): the challenge wallet's published main key.
import { getAddressDecoder, getAddressEncoder, getBase58Decoder, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { CHALLENGE_MAIN_KEYS, challengeKeypair } from '../src/challenge.ts';
import { fakeUpstream, testApp } from './fakes.ts';

// 64 bytes shaped like a keypair file: 32 bytes of "seed", then the public key. Not a real key: the seed does not
// derive the address, which the Worker does not check (it only refuses a secret for another address).
const keypairOf = (address: string): string =>
  getBase58Decoder().decode(Uint8Array.from([...Array.from({ length: 32 }, (_, i) => i + 1), ...getAddressEncoder().encode(address as Address)]));
const DEVNET_SECRET = keypairOf(CHALLENGE_MAIN_KEYS.devnet);
const MAINNET_SECRET = keypairOf(CHALLENGE_MAIN_KEYS.mainnet);
/** The second key of the mainnet challenge wallet: put here by mistake, it must never be served. */
const SECOND_KEY_SECRET = keypairOf('52HsrUZCJxr9Bh9ZWw8XL3jPLqnZ5DWvJqMAqerAJFLy');

const noUpstream = () =>
  fakeUpstream(() => {
    throw new Error('the challenge route never calls the RPC');
  });

async function challenge(cluster: Env['CLUSTER'], secret: string | undefined): Promise<Response> {
  const env: Partial<Env> = secret === undefined ? { CLUSTER: cluster } : { CLUSTER: cluster, CHALLENGE_MAIN_KEY: secret };
  return testApp(noUpstream(), { env }).request('/api/challenge');
}

describe('GET /api/challenge', () => {
  it("returns each cluster's main key and its public half, uncached", async () => {
    for (const [cluster, secret] of [['devnet', DEVNET_SECRET], ['mainnet', MAINNET_SECRET]] as const) {
      const response = await challenge(cluster, `${secret}\n`);
      expect(response.status, cluster).toBe(200);
      expect(response.headers.get('Cache-Control')).toContain('no-store');
      expect(await response.json()).toEqual({ mainKey: CHALLENGE_MAIN_KEYS[cluster], mainKeySecret: secret });
    }
  });

  it("is 503 for a keypair of any other address: the other cluster's main key or a second key", async () => {
    const cases: [Env['CLUSTER'], string][] = [
      ['mainnet', DEVNET_SECRET],
      ['devnet', MAINNET_SECRET],
      ['mainnet', SECOND_KEY_SECRET],
    ];
    for (const [cluster, secret] of cases) {
      const response = await challenge(cluster, secret);
      expect(response.status).toBe(503);
      const body = await response.text();
      expect(body).toContain('challenge-not-configured');
      expect(body).not.toContain(secret);
    }
  });

  it('is 503 while the secret is unset or not a keypair', async () => {
    for (const secret of [undefined, '', 'not base58 0OIl', CHALLENGE_MAIN_KEYS.mainnet]) {
      const response = await challenge('mainnet', secret);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: 'challenge-not-configured' });
    }
  });
});

describe('challengeKeypair', () => {
  it('accepts only 64 bytes of base58', () => {
    const bytes = Uint8Array.from({ length: 64 }, (_, i) => i + 1);
    const secret = getBase58Decoder().decode(bytes);
    expect(challengeKeypair(secret)).toEqual({ mainKey: getAddressDecoder().decode(bytes.slice(32)), mainKeySecret: secret });
    expect(challengeKeypair(getBase58Decoder().decode(bytes.slice(1)))).toBeNull();
  });
});
