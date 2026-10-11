// The public "Try to steal it" wallet on devnet (see challenge-wallet/challenge.ts). Usage:
//   pnpm challenge-wallet [--sol 1] [--undelegated]
// --undelegated skips the 1 SOL minimum delegation: any amount, but the account is not delegated.
// Keys: .keys/challenge-main.json (the main key, published), .keys/challenge-second.json (the second key, kept),
// both created on first use; paid by .keys/devnet-funder.json. Devnet only, checked by the genesis hash.
// Every run creates a new stake account for the same two keys. Exit code 0: created; 1: refused or failed.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { keyDisplayPath, keyPath, loadOrCreateKey } from './gate/keys.ts';
import { createRpcChain, GENESIS_HASH, PUBLIC_RPC_URL } from './gate/rpc.ts';
import { DevAccountsRefusal } from './dev-accounts/accounts.ts';
import { parseSol } from './dev-accounts/args.ts';
import { base58SecretKey, createChallenge, DEV_SITE, renderChallenge } from './challenge-wallet/challenge.ts';

const log = (line: string) => {
  console.log(line);
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { values } = parseArgs({
    args: argv[0] === '--' ? argv.slice(1) : argv,
    options: { sol: { type: 'string', default: '1' }, undelegated: { type: 'boolean', default: false } },
    strict: true,
  });
  const stakeLamports = parseSol(values.sol, '--sol');
  const envUrl = process.env['RPC_URL'];
  const chain = createRpcChain(envUrl === undefined || envUrl === '' ? PUBLIC_RPC_URL.devnet : envUrl, { log });
  if ((await chain.genesisHash()) !== GENESIS_HASH.devnet) {
    throw new DevAccountsRefusal('RPC_URL does not point to devnet (genesis hash differs); this script is devnet-only');
  }
  const { signer: funder } = await loadOrCreateKey('devnet-funder');
  const { signer: main } = await loadOrCreateKey('challenge-main');
  const { signer: second } = await loadOrCreateKey('challenge-second');
  const challenge = await createChallenge(
    chain,
    { funder, main, second },
    { stakeLamports, runId: `ch-${Date.now().toString(36)}`, undelegated: values.undelegated },
    log,
  );
  const secretKey = base58SecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath('challenge-main'), 'utf8')) as number[]));
  log('');
  for (const line of renderChallenge(
    challenge,
    { address: main.address, secretKey },
    { address: second.address, keyFile: keyDisplayPath('challenge-second') },
  )) {
    log(line);
  }
  const watch = await fetch(`${DEV_SITE}/api/watch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accounts: [challenge.stakeAccount] }),
  }).catch((error: unknown) => error);
  log(watch instanceof Response ? `POST /api/watch: HTTP ${String(watch.status)}` : `POST /api/watch failed: ${String(watch)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof DevAccountsRefusal ? error.message : error);
  process.exitCode = 1;
});
