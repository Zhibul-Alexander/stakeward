import { getBase58Decoder } from '@solana/kit';
import { commandLine } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { challengeCommands } from './commands.ts';
import { CHALLENGE } from './wallet.ts';

// 64 bytes shaped like a keypair file; not a real key.
const BYTES = Array.from({ length: 64 }, (_, i) => i + 1);
const SECRET = getBase58Decoder().decode(Uint8Array.from(BYTES));

describe('challengeCommands (D133, D154)', () => {
  it('saves the key as a solana-keygen keypair file: the JSON array of its 64 bytes', () => {
    expect(commandLine(challengeCommands(SECRET).keyFile)).toBe(`echo '${JSON.stringify(BYTES)}' > thief.json`);
  });

  it("signs every attempt with the stolen key and names the visitor's wallet as fee payer, on the build's network", () => {
    for (const [cluster, url] of [['devnet', 'devnet'], ['mainnet', 'mainnet-beta']] as const) {
      const commands = challengeCommands(SECRET, cluster);
      for (const argv of [commands.withdraw, commands.owner, commands.unlock]) {
        expect(argv[2]).toBe(CHALLENGE.stakeAccount);
        expect(argv).toContain('thief.json');
        expect(argv.slice(-6)).toEqual(['--fee-payer', 'me.json', '--keypair', 'me.json', '--url', url]);
      }
      expect(commandLine(commands.withdraw)).toContain('withdraw-stake');
      expect(commands.owner).toContain('--new-withdraw-authority');
      expect(commands.unlock).toContain('--custodian');
    }
  });

  it('airdrops the fees on devnet; on mainnet, with no faucet, shows the address to fund instead', () => {
    expect(commandLine(challengeCommands(SECRET, 'devnet').fund)).toBe('solana airdrop 1 --keypair me.json --url devnet');
    const mainnet = Object.values(challengeCommands(SECRET, 'mainnet')).map(commandLine);
    expect(mainnet).toContain('solana address -k me.json');
    expect(mainnet.join('\n')).not.toContain('airdrop');
  });

  it('never names the second key', () => {
    for (const cluster of ['devnet', 'mainnet'] as const) {
      for (const argv of Object.values(challengeCommands(SECRET, cluster))) expect(commandLine(argv)).not.toContain(CHALLENGE.secondKey);
    }
  });
});
