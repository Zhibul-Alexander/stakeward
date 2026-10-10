// Ledger simulation: signs every Stakeward transaction on the Ledger Solana app running in the Speculos emulator,
// records each screen the device shows, and checks the signature. Answers "does a Ledger show this transaction in
// clear text, or ask for blind signing?" without a device. Usage:
//   scripts/ledger-sim/speculos.sh          build the app and start Speculos (see that file)
//   pnpm ledger-sim                         SPECULOS_URL overrides http://127.0.0.1:5000; MODEL=nanox labels the report
// Writes docs/ledger-sim.md. The emulator uses Speculos' public test seed: never a real key.
import { writeFileSync } from 'node:fs';
import { getAddressDecoder } from '@solana/kit';
import { inspectTransaction } from '@stakeward/core';
import { buildCases } from './ledger-sim/cases.ts';
import { driveReview, type CaseResult } from './ledger-sim/drive.ts';
import { renderReport } from './ledger-sim/report.ts';
import { speculosClient } from './ledger-sim/speculos.ts';

const PATH = "44'/501'/0'";
const REPORT = new URL('../docs/ledger-sim.md', import.meta.url);

const baseUrl = process.env.SPECULOS_URL ?? 'http://127.0.0.1:5000';
const device = speculosClient(baseUrl);
const ledger = getAddressDecoder().decode(await device.getPubkey(PATH));
console.log(`Ledger (Speculos) ${PATH}: ${ledger}`);

const results: CaseResult[] = [];
for (const simCase of await buildCases(ledger)) {
  const inspected = await inspectTransaction(simCase.bytes);
  const result = await driveReview(device, PATH, ledger, simCase, inspected.ok ? null : inspected.error.code);
  results.push(result);
  console.log(`${result.outcome.padEnd(12)} ${simCase.id}`);
}

const appVersion = '1.15.2 (built by scripts/ledger-sim/speculos.sh)';
const model = process.env.MODEL === 'nanox' ? 'Nano X' : 'Nano S Plus';
writeFileSync(REPORT, renderReport({ date: new Date().toISOString().slice(0, 10), model, ledger, path: PATH, appVersion, results }));
console.log('docs/ledger-sim.md written');
if (results.some((result) => result.outcome === 'error' || result.signatureValid === false)) process.exitCode = 1;
