import { getBase58Encoder } from '@solana/kit';
import { cliUrl, type Cluster } from '@stakeward/core';
import { CLUSTER } from '@/config';
import { CHALLENGE } from './wallet.ts';

/** A file the commands create in the current directory: the visitor's own wallet, which pays the fees. */
const ME = 'me.json';
/** The published main key, saved as a solana-keygen keypair file. */
const THIEF = 'thief.json';
/** The visitor's own address, read from their wallet file by the shell. */
const MY_ADDRESS = `$(solana address -k ${ME})`;

export type ChallengeCommandId = 'wallet' | 'fund' | 'keyFile' | 'withdraw' | 'owner' | 'unlock';

/**
 * The Solana CLI commands of /challenge (D133, D154): make a wallet of your own for the fees, save the published main
 * key as a keypair file, then try the three things the lock forbids. Each attempt signs with the main key and pays
 * with the visitor's wallet (`--keypair`), so it needs no CLI config and the published key never needs SOL. `fund`
 * gets the fees: a devnet airdrop, or on mainnet the wallet's address for the visitor to send about 0.001 SOL to (no
 * faucet there). `mainKeySecret` is the base58 keypair from /api/challenge.
 */
export function challengeCommands(mainKeySecret: string, cluster: Cluster = CLUSTER): Readonly<Record<ChallengeCommandId, readonly string[]>> {
  const bytes = Array.from(getBase58Encoder().encode(mainKeySecret));
  const stake = CHALLENGE.stakeAccount;
  const url = ['--url', cliUrl(cluster)];
  return {
    wallet: ['solana-keygen', 'new', '--no-bip39-passphrase', '--outfile', ME],
    fund: cluster === 'devnet' ? ['solana', 'airdrop', '1', '--keypair', ME, ...url] : ['solana', 'address', '-k', ME],
    keyFile: ['echo', `'${JSON.stringify(bytes)}'`, '>', THIEF],
    withdraw: ['solana', 'withdraw-stake', stake, MY_ADDRESS, 'ALL', '--withdraw-authority', THIEF, '--keypair', ME, ...url],
    owner: ['solana', 'stake-authorize', stake, '--new-withdraw-authority', MY_ADDRESS, '--withdraw-authority', THIEF, '--keypair', ME, ...url],
    unlock: ['solana', 'stake-set-lockup', stake, '--lockup-date', '1970-01-01T00:00:00Z', '--custodian', THIEF, '--keypair', ME, ...url],
  };
}
