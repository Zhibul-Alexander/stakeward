// Live check of an RPC endpoint for what Stakeward needs from it (CLAUDE.md step 0):
// getProgramAccounts on the stake program filtered by withdrawer, then getMultipleAccounts on the results.
//
// Usage: pnpm check-rpc <rpc-url> [withdrawer]
//        RPC_URL=<rpc-url> pnpm check-rpc [withdrawer]
// Without a withdrawer the script picks a known sample address for mainnet or devnet (detected by genesis hash).
// The query string of the URL (where Helius keeps the API key) is never printed.

import { address, createSolanaRpc, parseBase64RpcAccount, type Address } from '@solana/kit';
import { decodeStakeStateAccount, STAKE_PROGRAM_ADDRESS, type StakeStateAccount } from '@solana-program/stake';
import { STAKE_ACCOUNT_OFFSETS, STAKE_ACCOUNT_SIZE } from '@stakeward/core';

const CLUSTER_BY_GENESIS_HASH: Record<string, 'mainnet' | 'devnet'> = {
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d': 'mainnet',
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: 'devnet',
};

// Withdrawers that own a handful of stake accounts (found while scouting on 2026-10-02).
const SAMPLE_WITHDRAWER = {
  mainnet: '57RQ3ocAibVdC3n3S9i4gT39EpF4DhRCbqAivyg6wtQ6',
  devnet: '63rAwzgKQ7P5CSHVtQi6Gasu3wVKhChmzxA2H2A5ssRD',
} as const;

const GPA_RUNS = 3;
const MULTIPLE_ACCOUNTS_LIMIT = 100;

function redact(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}${parsed.search === '' ? '' : '?<redacted>'}`;
}

async function timed<T>(run: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = performance.now();
  const value = await run();
  return { value, ms: Math.round(performance.now() - start) };
}

function withdrawerOf({ state }: StakeStateAccount): Address | null {
  return state.__kind === 'Initialized' || state.__kind === 'Stake' ? state.fields[0].authorized.withdrawer : null;
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const urlArg = args[0]?.startsWith('http') === true ? args.shift() : undefined;
  const url = urlArg ?? process.env['RPC_URL'];
  const withdrawerArg = args[0];
  if (url === undefined || url === '') {
    throw new Error('Usage: pnpm check-rpc <rpc-url> [withdrawer]  (or set RPC_URL)');
  }

  const rpc = createSolanaRpc(url);
  const genesis = await timed(() => rpc.getGenesisHash().send());
  const cluster = CLUSTER_BY_GENESIS_HASH[genesis.value] ?? 'unknown';
  console.log(`RPC        ${redact(url)}`);
  console.log(`cluster    ${cluster} (getGenesisHash ${String(genesis.ms)} ms)`);

  const withdrawerText = withdrawerArg ?? (cluster === 'unknown' ? undefined : SAMPLE_WITHDRAWER[cluster]);
  if (withdrawerText === undefined) {
    throw new Error('Unknown cluster: pass a withdrawer address as the second argument.');
  }
  const withdrawer = address(withdrawerText);
  console.log(`withdrawer ${withdrawer}`);

  const filters = [
    { dataSize: BigInt(STAKE_ACCOUNT_SIZE) },
    { memcmp: { offset: BigInt(STAKE_ACCOUNT_OFFSETS.withdrawer), bytes: withdrawer, encoding: 'base58' as const } },
  ];

  let addresses: Address[] = [];
  for (let run = 1; run <= GPA_RUNS; run++) {
    const result = await timed(() =>
      rpc
        .getProgramAccounts(STAKE_PROGRAM_ADDRESS, { encoding: 'base64', dataSlice: { offset: 0, length: 0 }, filters })
        .send(),
    );
    addresses = result.value.map((item) => item.pubkey);
    console.log(
      `getProgramAccounts dataSize=${String(STAKE_ACCOUNT_SIZE)} memcmp@${String(STAKE_ACCOUNT_OFFSETS.withdrawer)} ` +
        `dataSlice{0,0} base64, run ${String(run)}: ${String(addresses.length)} accounts, ${String(result.ms)} ms`,
    );
  }

  const full = await timed(() => rpc.getProgramAccounts(STAKE_PROGRAM_ADDRESS, { encoding: 'base64', filters }).send());
  console.log(`getProgramAccounts same filters, full data base64: ${String(full.value.length)} accounts, ${String(full.ms)} ms`);

  let found = 0;
  let matching = 0;
  let totalMs = 0;
  let calls = 0;
  for (let i = 0; i < addresses.length; i += MULTIPLE_ACCOUNTS_LIMIT) {
    const batch = addresses.slice(i, i + MULTIPLE_ACCOUNTS_LIMIT);
    const result = await timed(() => rpc.getMultipleAccounts(batch, { encoding: 'base64' }).send());
    totalMs += result.ms;
    calls += 1;
    result.value.value.forEach((info, index) => {
      const pubkey = batch[index];
      if (info === null || pubkey === undefined) return;
      found += 1;
      const encoded = parseBase64RpcAccount(pubkey, info);
      if (encoded.programAddress !== STAKE_PROGRAM_ADDRESS || encoded.data.length !== STAKE_ACCOUNT_SIZE) return;
      if (withdrawerOf(decodeStakeStateAccount(encoded).data) === withdrawer) matching += 1;
    });
  }
  console.log(
    `getMultipleAccounts base64 (${String(calls)} call(s)): ${String(found)}/${String(addresses.length)} found, ` +
      `${String(matching)} decoded with this withdrawer, ${String(totalMs)} ms`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
