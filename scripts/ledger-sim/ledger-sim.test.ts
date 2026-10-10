import { describe, expect, it } from 'vitest';
import { generateKeyPairSigner } from '@solana/kit';
import { inspectTransaction } from '@stakeward/core';
import { buildCases } from './cases.ts';
import { messageOf } from './drive.ts';
import { joinScreen } from './report.ts';
import { serializePath } from './speculos.ts';

describe('ledger simulation', () => {
  it('serializes a BIP 32 path the way the Solana app reads it', () => {
    expect(Buffer.from(serializePath("44'/501'/0'")).toString('hex')).toBe('03' + '8000002c' + '800001f5' + '80000000');
    expect(Buffer.from(serializePath("m/44'/501'/1'/0'")).toString('hex')).toBe('04' + '8000002c' + '800001f5' + '80000001' + '80000000');
  });

  it('takes the message after the signature slots', () => {
    const bytes = Uint8Array.of(2, ...new Uint8Array(128), 7, 8, 9);
    expect([...messageOf(bytes)]).toEqual([7, 8, 9]);
  });

  it('joins an address wrapped over several device lines', () => {
    expect(joinScreen(['New authority', '3ut8KBXoqd1pB989L', 'aH2ifj'])).toBe('New authority | 3ut8KBXoqd1pB989LaH2ifj');
    expect(joinScreen(['Sign transaction'])).toBe('Sign transaction');
  });

  it('builds only what the inspector accepts, plus the variants it must refuse', async () => {
    const ledger = (await generateKeyPairSigner()).address;
    const cases = await buildCases(ledger);
    for (const simCase of cases) {
      const result = await inspectTransaction(simCase.bytes);
      expect(result.ok, simCase.id).toBe(simCase.variant !== 'generated layout, no sysvars (control for D1)');
      if (result.ok) expect(result.summary.requiredSigners, simCase.id).toContain(ledger);
    }
    expect(cases.some((c) => c.variant === 'phantom lighthouse tail')).toBe(true);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });
});
