// The public "Try to steal it" wallet on devnet: a delegated stake account whose main key (staker = withdrawer = A) is
// published, protected by the product's own SetLockupChecked until 31 December 2099 with a second key K that stays
// in .keys/. Whoever holds A can deactivate, redelegate, split and change the staker; withdrawing the SOL or taking
// the withdrawer needs K. Devnet only: the SOL is worthless, the point is the public proof.
//
// Two transactions, both paid by the devnet funder (a published key never pays: anyone could drain it first):
//   1. dev-accounts' setup: a delegated stake account, staker = withdrawer = A, no lockup;
//   2. the product's protect transaction from core: SetLockupChecked { unixTimestamp: T }, signed by A and K.
import { getBase58Decoder, type Address, type KeyPairSigner, type Signature } from '@solana/kit';
import { decodeStakeAccount, formatSol, type StakeAccount } from '@stakeward/core';
import type { GateChain } from '../gate/chain.ts';
import { describeError } from '../gate/checks.ts';
import { createSender } from '../gate/sender.ts';
import { createDevAccounts, DevAccountsRefusal, explorerUrl, planDevAccounts } from '../dev-accounts/accounts.ts';

/** 2099-12-31 00:00:00 UTC. */
export const CHALLENGE_LOCK_UNTIL = 4_102_358_400n;
export const DEV_SITE = 'https://stakeward-dev.stakeward.workers.dev';

export type Challenge = {
  stakeAccount: Address;
  setup: Signature;
  protect: Signature;
  state: StakeAccount;
};

/** A solana-keygen key file (64 bytes: seed, then public key) as base58, the form wallets import as a private key. */
export function base58SecretKey(keyFileBytes: Uint8Array): string {
  if (keyFileBytes.length !== 64) throw new Error('A key file holds 64 bytes');
  return getBase58Decoder().decode(keyFileBytes);
}

export async function createChallenge(
  chain: GateChain,
  keys: { funder: KeyPairSigner; main: KeyPairSigner; second: KeyPairSigner },
  options: { stakeLamports: bigint; runId: string; undelegated?: boolean },
  log: (line: string) => void = () => undefined,
): Promise<Challenge> {
  const { funder, main, second } = keys;
  if (new Set([funder.address, main.address, second.address]).size !== 3) {
    throw new DevAccountsRefusal('The funder, the main key and the second key must be three different keys');
  }
  const plan = await planDevAccounts(chain, funder.address, {
    target: main.address,
    kinds: [options.undelegated === true ? 'undelegated' : 'delegated'],
    delegatedLamports: options.stakeLamports,
    undelegatedLamports: options.stakeLamports,
    runId: options.runId,
  });
  const { accounts } = await createDevAccounts(chain, funder, plan, log);
  const [created] = accounts;
  if (created === undefined) throw new Error('No stake account was created');

  const sender = createSender(chain, new Map(), log);
  const action = {
    kind: 'protect',
    stakeAccount: created.address,
    mainKey: main.address,
    secondKey: second.address,
    lockUntil: CHALLENGE_LOCK_UNTIL,
  } as const;
  const { outcome, bytes } = await sender.send('protect', sender.product(action, [funder, main, second], funder.address));
  if (outcome.status !== 'ok') {
    const reason = outcome.status === 'failed' ? describeError(outcome.error, bytes) : 'did not land';
    throw new Error(`Protecting ${created.address} failed: ${reason} (${explorerUrl('tx', outcome.signature)})`);
  }

  const raw = await chain.account(created.address);
  const decoded = raw === null ? null : decodeStakeAccount(raw);
  if (decoded === null || !decoded.ok) throw new Error(`${created.address} cannot be read back after ${outcome.signature}`);
  const { lockup, staker, withdrawer } = decoded.account;
  if (lockup.unixTimestamp !== CHALLENGE_LOCK_UNTIL || lockup.custodian !== second.address) {
    throw new Error(`${created.address} is not locked as planned after ${outcome.signature}`);
  }
  if (options.undelegated !== true && decoded.account.kind !== 'delegated') {
    throw new Error(`${created.address} is not delegated after ${outcome.signature}`);
  }
  if (staker !== main.address || withdrawer !== main.address) {
    throw new Error(`${created.address} has unexpected keys after ${outcome.signature}`);
  }
  return { stakeAccount: created.address, setup: created.signature, protect: outcome.signature, state: decoded.account };
}

/** What the run prints: the public part first, then where the second key stays. */
export function renderChallenge(
  challenge: Challenge,
  main: { address: Address; secretKey: string },
  second: { address: Address; keyFile: string },
): string[] {
  return [
    'Try to steal it (devnet)',
    `  stake account  ${challenge.stakeAccount}, ${formatSol(challenge.state.lamports)}, locked until 2099-12-31`,
    `                 ${explorerUrl('address', challenge.stakeAccount)}`,
    `  main key       ${main.address}`,
    `  main key secret (PUBLIC, import into any wallet on devnet):`,
    `                 ${main.secretKey}`,
    `  proof page     ${DEV_SITE}/proof/${main.address}`,
    `  protected by   ${explorerUrl('tx', challenge.protect)}`,
    `  second key     ${second.address} (${second.keyFile}; never publish it)`,
  ];
}
