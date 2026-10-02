// Devnet stake accounts for a wallet you test the site with (CLAUDE.md step 3). Usage: see dev-accounts/args.ts or
//   pnpm dev-accounts --help
// Paid by the gate's devnet funder (.keys/devnet-funder.json, created on first use). Devnet only: the RPC endpoint is
// checked by its genesis hash. Exit code 0: created, or --dry-run; 1: refused or failed.
import { keyDisplayPath, loadOrCreateKey } from './gate/keys.ts';
import { createRpcChain, GENESIS_HASH, PUBLIC_RPC_URL } from './gate/rpc.ts';
import {
  createDevAccounts,
  DevAccountsRefusal,
  fundingMessage,
  planDevAccounts,
  renderCreated,
  renderPlan,
} from './dev-accounts/accounts.ts';
import { parseDevAccountsArgs, USAGE, UsageError } from './dev-accounts/args.ts';

const FUNDER_FILE = 'devnet-funder';

const log = (line: string) => {
  console.log(line);
};

async function main(): Promise<void> {
  const args = parseDevAccountsArgs(process.argv.slice(2));
  if (args.help) {
    log(USAGE);
    return;
  }
  const envUrl = process.env['RPC_URL'];
  const chain = createRpcChain(envUrl === undefined || envUrl === '' ? PUBLIC_RPC_URL.devnet : envUrl, { log });
  if ((await chain.genesisHash()) !== GENESIS_HASH.devnet) {
    throw new DevAccountsRefusal('RPC_URL does not point to devnet (genesis hash differs); this script is devnet-only');
  }
  const { signer: funder, created } = await loadOrCreateKey(FUNDER_FILE);
  const keyFile = `${keyDisplayPath(FUNDER_FILE)}${created ? ', new' : ''}`;
  const plan = await planDevAccounts(chain, funder.address, {
    target: args.target,
    kinds: args.kinds,
    delegatedLamports: args.delegatedLamports,
    undelegatedLamports: args.undelegatedLamports,
    runId: Date.now().toString(36),
  });
  for (const line of renderPlan(plan, keyFile)) log(line);

  const enough = plan.balance >= plan.required;
  if (args.dryRun) {
    log(enough ? 'Dry run: the funder holds enough. Nothing sent.' : `Dry run, nothing sent. ${fundingMessage(plan)}`);
    log('A real run derives new addresses from its own run id.');
    return;
  }
  if (!enough) throw new DevAccountsRefusal(fundingMessage(plan));

  const result = await createDevAccounts(chain, funder, plan, log);
  log('');
  for (const line of renderCreated(plan, result.accounts, result.fees)) log(line);
}

main().catch((error: unknown) => {
  if (error instanceof UsageError) console.error(`${error.message}\n\n${USAGE}`);
  else if (error instanceof DevAccountsRefusal) console.error(error.message);
  else console.error(error);
  process.exitCode = 1;
});
