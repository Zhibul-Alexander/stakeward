import { getBase58Decoder } from '@solana/kit';
import { commandLine } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { challengeCommands } from './commands.ts';
import { CHALLENGE } from './wallet.ts';

// 64 bytes shaped like a keypair file; not a real key.
const BYTES = Array.from({ length: 64 }, (_, i) => i + 1);
const SECRET = getBase58Decoder().decode(Uint8Array.from(BYTES));

describe('challengeCommands (D133)', () => {
  const commands = challengeCommands(SECRET);

  it('saves the key as a solana-keygen keypair file: the JSON array of its 64 bytes', () => {
    expect(commandLine(commands.keyFile)).toBe(`echo '${JSON.stringify(BYTES)}' > thief.json`);
  });

  it('signs every attempt with the stolen key and pays with the visitor wallet, on devnet', () => {
    for (const argv of [commands.withdraw, commands.owner, commands.unlock]) {
      expect(argv[2]).toBe(CHALLENGE.stakeAccount);
      expect(argv).toContain('thief.json');
      expect(argv.slice(-4)).toEqual(['--keypair', 'me.json', '--url', 'devnet']);
    }
    expect(commandLine(commands.withdraw)).toContain('withdraw-stake');
    expect(commands.owner).toContain('--new-withdraw-authority');
    expect(commands.unlock).toContain('--custodian');
  });

  it('never names the second key', () => {
    for (const argv of Object.values(commands)) expect(commandLine(argv)).not.toContain(CHALLENGE.secondKey);
  });
});
