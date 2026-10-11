import { getBase58Encoder } from '@solana/kit';
import { CHALLENGE } from './wallet.ts';

/** A file the commands create in the current directory: the visitor's own devnet wallet, which pays the fees. */
const ME = 'me.json';
/** The published main key, saved as a solana-keygen keypair file. */
const THIEF = 'thief.json';
/** The visitor's own address, read from their wallet file by the shell. */
const MY_ADDRESS = `$(solana address -k ${ME})`;
const DEVNET = ['--url', 'devnet'];

export type ChallengeCommandId = 'wallet' | 'airdrop' | 'keyFile' | 'withdraw' | 'owner' | 'unlock';

/**
 * The Solana CLI commands of /challenge (D133): make a devnet wallet for the fees, save the published main key as a
 * keypair file, then try the three things the lock forbids. Each attempt signs with the main key and pays with the
 * visitor's wallet (`--keypair`), so it needs no CLI config. `mainKeySecret` is the base58 keypair from /api/challenge.
 */
export function challengeCommands(mainKeySecret: string): Readonly<Record<ChallengeCommandId, readonly string[]>> {
  const bytes = Array.from(getBase58Encoder().encode(mainKeySecret));
  const stake = CHALLENGE.stakeAccount;
  return {
    wallet: ['solana-keygen', 'new', '--no-bip39-passphrase', '--outfile', ME],
    airdrop: ['solana', 'airdrop', '1', '--keypair', ME, ...DEVNET],
    keyFile: ['echo', `'${JSON.stringify(bytes)}'`, '>', THIEF],
    withdraw: ['solana', 'withdraw-stake', stake, MY_ADDRESS, 'ALL', '--withdraw-authority', THIEF, '--keypair', ME, ...DEVNET],
    owner: ['solana', 'stake-authorize', stake, '--new-withdraw-authority', MY_ADDRESS, '--withdraw-authority', THIEF, '--keypair', ME, ...DEVNET],
    unlock: ['solana', 'stake-set-lockup', stake, '--lockup-date', '1970-01-01T00:00:00Z', '--custodian', THIEF, '--keypair', ME, ...DEVNET],
  };
}
