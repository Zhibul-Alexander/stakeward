// scripts/recovery-cli without the Solana CLI (CI has none): arguments, the mainnet refusal, the help-page check
// against a saved 4.3.0 page, the docs section, the double-quote filling and the funding plan. The run itself is
// docs/recovery-cli.md.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  commandLine,
  recoveryCommands,
  RECOVERY_PLACEHOLDERS,
  type RecoveryCommandId,
  type RecoveryPlaceholder,
} from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { GENESIS_HASH } from '../gate/rpc.ts';
import {
  clusterOfGenesis,
  parseRecoveryCliArgs,
  RecoveryCliRefusal,
  redactText,
  redactUrl,
  resolveUrl,
  URL_MONIKERS,
  UsageError,
} from './args.ts';
import {
  feeSignatures,
  fundingPlan,
  helpCheck,
  installerCheck,
  LAMPORTS_PER_SIGNATURE,
  type CheckResult,
} from './checks.ts';
import { consoleReport, renderSection, TABLE_HEADER, upsertSection, type RecoveryCliReport } from './report.ts';
import {
  clockUnixTimestamp,
  createSolanaCli,
  fillCommand,
  flagsOf,
  helpListsFlag,
  parseCliVersion,
  parseLamports,
  parseSignatures,
  placeholdersIn,
  quote,
  shellArgv,
  solArgument,
  type CliResult,
  type SolanaCli,
} from './solana.ts';

const HELP_4_3_0 = readFileSync(new URL('fixtures/stake-set-lockup-help-4.3.0.txt', import.meta.url), 'utf8');
const MAIN = 'Dj49ykHTiF2YoHzSqfgPVK6ZbwxvKKf491j67wP8Kbg2';
const RPC_URL = 'http://127.0.0.1:8899';
const TEMPLATES = recoveryCommands({ mainKeyAddress: MAIN, url: RPC_URL });
const IDS = Object.keys(TEMPLATES) as RecoveryCommandId[];

/** What the run fills: key files, a stake account, a date. */
const VALUES: Record<Exclude<RecoveryPlaceholder, '<MAIN_KEY_ADDRESS>'>, string> = {
  '<STAKE_ACCOUNT>': '3gbzH9ZYrsVPyfm3Xbf3c1UKhvxjkTu6BSMaCYYowtyA',
  '<MAIN_KEY>': '/repo/.keys/recovery-localnet/main.json',
  '<SECOND_KEY>': '/repo/.keys/recovery-localnet/second.json',
  '<NEW_WALLET>': '/repo/.keys/recovery-localnet/new.json',
  '<NEW_SECOND_KEY>': '/repo/.keys/recovery-localnet/second2.json',
  '<NEW_END_DATE>': '2026-10-05T19:10:04Z',
};

describe('arguments', () => {
  it('defaults to devnet and the gate funder in .keys/', () => {
    const args = parseRecoveryCliArgs([], '/somewhere');
    expect(args).toMatchObject({
      help: false,
      url: URL_MONIKERS.devnet,
      defaultFunder: true,
      skipDelegated: false,
      dryRun: false,
    });
    if (args.help) throw new Error('unexpected');
    expect(args.funder).toMatch(/\/\.keys\/devnet-funder\.json$/);
    expect(args.funder.startsWith('/somewhere')).toBe(false);
  });

  it('maps the monikers and passes other URLs through', () => {
    expect(resolveUrl('devnet')).toBe('https://api.devnet.solana.com');
    expect(resolveUrl('localhost')).toBe('http://127.0.0.1:8899');
    expect(resolveUrl('https://devnet.helius-rpc.com/?api-key=x')).toBe('https://devnet.helius-rpc.com/?api-key=x');
    expect(() => resolveUrl('mainnet')).toThrow(UsageError);
    expect(() => resolveUrl('ftp://example.com')).toThrow(UsageError);
  });

  it('refuses a URL that double quotes would not keep as is in the typed line', () => {
    const bad = ['https://h.example/?a="b"', 'https://h.example/$x', 'https://h.example/`id`', 'https://h.example/a\\b'];
    for (const url of bad) expect(() => resolveUrl(url), url).toThrow(UsageError);
    expect(resolveUrl('https://h.example/?a=1&b=2')).toBe('https://h.example/?a=1&b=2');
  });

  it('reads every flag, a pnpm `--` and a funder relative to where pnpm started', () => {
    const args = parseRecoveryCliArgs(
      ['--', '--url', 'localhost', '--funder', '.keys/localnet-funder.json', '--skip-delegated', '--dry-run'],
      '/repo',
    );
    expect(args).toEqual({
      help: false,
      url: 'http://127.0.0.1:8899',
      funder: '/repo/.keys/localnet-funder.json',
      defaultFunder: false,
      skipDelegated: true,
      dryRun: true,
    });
    expect(parseRecoveryCliArgs(['--funder', '/abs/key.json'], '/repo')).toMatchObject({ funder: '/abs/key.json' });
    expect(parseRecoveryCliArgs(['--help'])).toEqual({ help: true });
  });

  it('rejects unknown flags and positionals', () => {
    expect(() => parseRecoveryCliArgs(['--cluster', 'devnet'])).toThrow(UsageError);
    expect(() => parseRecoveryCliArgs(['devnet'])).toThrow(UsageError);
  });

  it('refuses mainnet by its genesis hash', () => {
    expect(() => clusterOfGenesis(GENESIS_HASH.mainnet)).toThrow(RecoveryCliRefusal);
    expect(clusterOfGenesis(GENESIS_HASH.devnet)).toBe('devnet');
    expect(clusterOfGenesis('EDMTgBC48Waxom3MgNTVsLnnrdytXSc2DkEk282WevqK')).toBe('localnet');
  });
});

describe('help pages', () => {
  it('finds every flag of the extend and remove-lock templates on the saved 4.3.0 stake-set-lockup page', () => {
    for (const id of ['extend', 'remove-lock'] as const) {
      expect(TEMPLATES[id][1]).toBe('stake-set-lockup');
      for (const flag of flagsOf(TEMPLATES[id])) expect(helpListsFlag(HELP_4_3_0, flag), flag).toBe(true);
    }
    expect(helpListsFlag(HELP_4_3_0, '--new-custodian')).toBe(true);
  });

  it('does not take a prefix, a longer flag or a usage line for a listed option', () => {
    expect(helpListsFlag(HELP_4_3_0, '--lockup')).toBe(false);
    expect(helpListsFlag(HELP_4_3_0, '--new-stake-authority')).toBe(false);
    expect(helpListsFlag('        --new-custodian <PUBKEY>', '--custodian')).toBe(false);
    expect(helpListsFlag('    solana x <A|--custodian <KEYPAIR>>', '--custodian')).toBe(false);
    expect(helpListsFlag('    -u, --url <URL_OR_MONIKER>', '--url')).toBe(true);
    expect(helpListsFlag('        --fee-payer=<KEYPAIR>', '--fee-payer')).toBe(true);
  });

  /** A CLI whose help pages list exactly the given flags; stake-set-lockup answers with the saved page. */
  function helpCli(drop: { sub: string; flag: string } | null = null): SolanaCli {
    const ok = (output: string): CliResult => ({ ok: true, status: 0, output });
    return {
      run: (program, args) => {
        if (program === 'solana-keygen') return ok('USAGE:\n    solana-keygen pubkey [KEYPAIR]\n');
        const sub = args[0] ?? '';
        if (sub === 'stake-set-lockup' && drop === null) return ok(HELP_4_3_0);
        const flags = new Set(IDS.filter((id) => TEMPLATES[id][1] === sub).flatMap((id) => flagsOf(TEMPLATES[id])));
        if (drop !== null && drop.sub === sub) flags.delete(drop.flag);
        return ok([...flags].map((flag) => `        ${flag} <VALUE>    Some text`).join('\n'));
      },
      shell: () => ok(''),
      shells: ['bash'],
      home: '/tmp/empty',
    };
  }

  it('H passes when every template flag is listed', () => {
    const result = helpCheck(helpCli(), TEMPLATES);
    expect(result).toMatchObject({ id: 'H', passed: true, outcome: 'шаблонов: 10, подкоманд: 8, флагов: 33' });
  });

  it('H names the flag a help page lacks', () => {
    const result = helpCheck(helpCli({ sub: 'stake-authorize-checked', flag: '--custodian' }), TEMPLATES);
    expect(result.passed).toBe(false);
    expect(result.outcome).toBe('нет в справке: stake-authorize-checked --custodian');
  });
});

describe('installer check (I1)', () => {
  const fakeFetch = (status: number | Error) =>
    (async (input: string | URL | Request, init?: RequestInit) => {
      await Promise.resolve();
      expect(input).toBe('https://release.anza.xyz/v4.3.0/install');
      expect(init?.method).toBe('HEAD');
      if (status instanceof Error) throw status;
      return new Response(null, { status });
    }) as typeof fetch;

  it('passes on 200 only', async () => {
    expect(await installerCheck(fakeFetch(200))).toMatchObject({ passed: true, outcome: 'HTTP 200' });
    expect(await installerCheck(fakeFetch(404))).toMatchObject({ passed: false, outcome: 'HTTP 404' });
    expect((await installerCheck(fakeFetch(new TypeError('fetch failed')))).passed).toBe(false);
  });
});

describe('filling a card command', () => {
  it('puts every value in double quotes and leaves the rest as the card prints it', () => {
    const filled = fillCommand(TEMPLATES.withdraw, VALUES);
    expect(filled.line).toBe(
      'solana withdraw-stake "3gbzH9ZYrsVPyfm3Xbf3c1UKhvxjkTu6BSMaCYYowtyA" "/repo/.keys/recovery-localnet/main.json" ALL ' +
        '--withdraw-authority "/repo/.keys/recovery-localnet/main.json" ' +
        '--custodian "/repo/.keys/recovery-localnet/second.json" ' +
        '--fee-payer "/repo/.keys/recovery-localnet/main.json" --url http://127.0.0.1:8899',
    );
    const lookup: Partial<Record<string, string>> = VALUES;
    expect(filled.argv).toEqual(TEMPLATES.withdraw.map((token) => lookup[token] ?? token));
    expect(filled.left).toEqual([]);
  });

  it('leaves no placeholder in any template once every value is given', () => {
    for (const id of IDS) {
      const filled = fillCommand(TEMPLATES[id], VALUES);
      expect(filled.left, id).toEqual([]);
      expect(placeholdersIn(filled.argv), id).toEqual([]);
      expect(filled.line, id).not.toMatch(/<[A-Z_]+>/);
    }
  });

  it('reports what is left unfilled', () => {
    const { '<SECOND_KEY>': _second, ...withoutSecond } = VALUES;
    expect(fillCommand(TEMPLATES.extend, withoutSecond).left).toEqual([RECOVERY_PLACEHOLDERS.secondKey]);
    expect(fillCommand(TEMPLATES.extend, withoutSecond).line).toContain('--custodian <SECOND_KEY> --fee-payer <SECOND_KEY>');
  });

  it('replaces the value after a flag with a placeholder or a quoted literal', () => {
    const mainPays = fillCommand(TEMPLATES.extend, VALUES, { '--fee-payer': '<MAIN_KEY>' });
    expect(mainPays.line).toContain('--custodian "/repo/.keys/recovery-localnet/second.json" --fee-payer "/repo/.keys/recovery-localnet/main.json"');
    const wrongKey = fillCommand(TEMPLATES.rescue, VALUES, { '--custodian': '/repo/.keys/recovery-localnet/thief.json' });
    expect(wrongKey.line).toContain('--custodian "/repo/.keys/recovery-localnet/thief.json"');
    expect(wrongKey.argv).toContain('/repo/.keys/recovery-localnet/thief.json');
    expect(() => fillCommand(TEMPLATES.show, VALUES, { '--fee-payer': '<MAIN_KEY>' })).toThrow(/no --fee-payer/);
  });

  it('gives the display form of the same typed line', () => {
    const filled = fillCommand(TEMPLATES.show, VALUES);
    expect(filled.displayLines).toEqual([
      'solana stake-account \\',
      '  "3gbzH9ZYrsVPyfm3Xbf3c1UKhvxjkTu6BSMaCYYowtyA" \\',
      '  --url http://127.0.0.1:8899',
    ]);
    expect(filled.displayLines.join('\n').replace(/ \\\n {2}/g, ' ')).toBe(filled.line);
    expect(commandLine(filled.argv)).toBe(filled.line.replace(/"/g, ''));
  });

  it('puts a custom --url in double quotes when a shell would change it, so bash and zsh pass it as typed', () => {
    const url = 'https://devnet.helius-rpc.com/?api-key=x&cluster=devnet';
    const filled = fillCommand(recoveryCommands({ mainKeyAddress: MAIN, url }).epoch, VALUES);
    expect(filled.line).toBe(`solana epoch-info --url "${url}"`);
    expect(filled.argv).toEqual(['solana', 'epoch-info', '--url', url]);
    expect(filled.displayLines).toEqual(['solana epoch-info \\', `  --url "${url}"`]);
    // zsh stops at `?` (no matches found) and bash at `&` (a background job) when the URL is not quoted.
    const home = mkdtempSync(join(tmpdir(), 'recovery-cli-test-'));
    try {
      expect(shellArgv(createSolanaCli({ home, bin: undefined }), 'bash', filled.line)).toEqual(filled.argv);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('refuses a value the double quotes would not keep as is', () => {
    expect(quote('/a b/key.json')).toBe('"/a b/key.json"');
    for (const bad of ['a"b', '$HOME/key.json', '`id`', 'C:\\keys\\a.json']) expect(() => quote(bad), bad).toThrow();
  });
});

describe('output parsing', () => {
  it('reads the CLI version, lamports, signatures and the Clock', () => {
    expect(parseCliVersion('solana-cli 4.3.0 (src:44b42d45; feat:c9ad34d2, client:Agave)\n')).toBe('4.3.0');
    expect(parseLamports('Rent-exempt minimum: 2282880 lamports\n')).toBe(2_282_880n);
    expect(parseLamports('1000000000 lamports\n')).toBe(1_000_000_000n);
    expect(parseLamports('Error: x')).toBeNull();
    const signature = '4rwut1VEnoQ28hQfG5ABVfsvH7KKUQSvy4PTVcwhXJn9GV8jeTuNiaoxDdyRb5JgnGUxDadbAFB1G5yHzMv48HNS';
    expect(parseSignatures(`\nSignature: ${signature}\n\n`)).toEqual([signature]);
    // slot 38, epoch_start_timestamp, epoch 0, leader_schedule_epoch 1, unix_timestamp
    expect(clockUnixTimestamp('JgAAAAAAAAAou8NqAAAAAAAAAAAAAAAAAQAAAAAAAABEu8NqAAAAAA==')).toBe(1_791_212_356n);
  });

  it('writes CLI amounts in SOL with a dot', () => {
    expect(solArgument(1_002_282_880n)).toBe('1.00228288');
    expect(solArgument(2_000_000_000n)).toBe('2');
    expect(solArgument(3_282_880n)).toBe('0.00328288');
  });
});

describe('funding plan', () => {
  const devnetRent = 1_666_240n; // DECISIONS.md D22

  it('asks about 1.15 SOL on devnet, about 0.13 SOL without the delegated account', () => {
    const full = fundingPlan({ rent: devnetRent, minDelegation: 1_000_000_000n, skipDelegated: false });
    expect(full.required).toBe(1_124_354_920n);
    const skip = fundingPlan({ rent: devnetRent, minDelegation: 1_000_000_000n, skipDelegated: true });
    expect(skip.required).toBe(121_688_680n);
    expect(skip.delegatedLamports).toBeNull();
  });

  it('expects the fees of every transaction a passing run lands', () => {
    // The localnet run (docs/recovery-cli.md) spent exactly this: 75 signatures with the delegated account.
    expect(feeSignatures(false)).toBe(75);
    expect(fundingPlan({ rent: 2_282_880n, minDelegation: 1_000_000_000n, skipDelegated: false }).fees).toBe(
      75n * LAMPORTS_PER_SIGNATURE,
    );
    // Without the delegated account: no create (A, key), lock (A, K), delegate, N9 (X, A; A) or C8 (A; A, K).
    expect(feeSignatures(true)).toBe(75 - 2 - 2 - 1 - 3 - 3);
  });
});

describe('docs/recovery-cli.md', () => {
  const result = (overrides: Partial<CheckResult>): CheckResult => ({
    id: 'N1',
    title: 'withdraw-alone',
    expected: 'ошибка `lockup has not yet expired`',
    passed: true,
    outcome: 'ошибка',
    signatures: [],
    message: 'Error: lockup has not yet expired',
    produced: 'lockup',
    ...overrides,
  });
  const report = (cluster: 'localnet' | 'devnet'): RecoveryCliReport => ({
    cluster,
    url: RPC_URL,
    startedAt: new Date('2026-10-05T15:14:05Z'),
    cliVersion: 'solana-cli 4.3.0',
    shells: ['GNU bash, version 5.2.21'],
    funder: MAIN,
    keys: [{ role: 'A (основной)', address: MAIN }],
    locks: [],
    results: [
      result({}),
      result({
        id: 'C2',
        passed: false,
        outcome: 'a | b',
        message: null,
        produced: null,
        signatures: ['4rwut1VEnoQ28hQfG5ABVfsvH7KKUQSvy4PTVcwhXJn9GV8jeTuNiaoxDdyRb5JgnGUxDadbAFB1G5yHzMv48HNS'],
      }),
    ],
    spent: 375_000n,
    notes: [],
    aborted: null,
  });

  it('creates the file with both sections and rewrites only the given one', () => {
    const first = upsertSection(null, 'localnet', 'LOCAL ONE');
    expect(first).toContain('# Команды карточки восстановления');
    expect(first).toContain('<!-- recovery-cli:localnet:begin -->\nLOCAL ONE\n<!-- recovery-cli:localnet:end -->');
    expect(first).toContain('<!-- recovery-cli:devnet:begin -->\n## Devnet\n\nЕщё не запускался.\n<!-- recovery-cli:devnet:end -->');
    const second = upsertSection(upsertSection(first, 'devnet', 'DEVNET'), 'localnet', 'LOCAL TWO');
    expect(second).toContain('LOCAL TWO');
    expect(second).not.toContain('LOCAL ONE');
    expect(second).toContain('<!-- recovery-cli:devnet:begin -->\nDEVNET\n<!-- recovery-cli:devnet:end -->');
    expect(upsertSection(second, 'localnet', 'LOCAL TWO')).toBe(second);
  });

  it('renders the results table, escaping pipes, with explorer links on devnet only', () => {
    const local = renderSection(report('localnet'));
    expect(local).toContain(TABLE_HEADER);
    expect(local).toContain('1 из 2 проверок прошли');
    expect(local).toContain('| C2 | withdraw-alone | ошибка `lockup has not yet expired` | **НЕ прошла**: a \\| b | `4rwu…8HNS` |');
    expect(local).toContain('| N1 | withdraw-alone | ошибка `lockup has not yet expired` | прошла: ошибка | `Error: lockup has not yet expired` |');
    expect(local).toContain('375 000 лампортов');
    const devnet = renderSection(report('devnet'));
    expect(devnet).toContain('[4rwu…8HNS](https://explorer.solana.com/tx/4rwut1VEnoQ28hQfG5ABVfsvH7KKUQSvy4PTVcwhXJn9GV8jeTuNiaoxDdyRb5JgnGUxDadbAFB1G5yHzMv48HNS?cluster=devnet)');
    expect(local).toContain('RPC `http://127.0.0.1:8899`.');
    expect(devnet).toContain('RPC `http://127.0.0.1:8899`.');
  });

  it('never writes the API key of a provider URL: not in the RPC line, not in any CLI text the run quotes', () => {
    // The committed doc; Helius keeps the key in the query string (DECISIONS.md), the CLI prints the URL it failed on.
    const url = 'https://devnet.helius-rpc.com?api-key=SECRET123';
    const failed = `Error: error sending request for url (https://devnet.helius-rpc.com/?api-key=SECRET123)`;
    const leaky: RecoveryCliReport = {
      ...report('devnet'),
      url,
      results: [result({ passed: false, outcome: `bash: ${failed}`, message: failed })],
      notes: [`note ${url}`],
      aborted: `подготовка не прошла: ${failed}`,
    };
    for (const text of [renderSection(leaky), consoleReport(leaky)]) {
      expect(text).not.toContain('SECRET123');
      expect(text).not.toContain('api-key');
    }
    expect(renderSection(leaky)).toContain('RPC `https://devnet.helius-rpc.com/…`.');
    expect(renderSection(leaky)).toContain('error sending request for url (https://devnet.helius-rpc.com/…)');
  });
});

describe('RPC URL redaction', () => {
  it('shows the origin only, with … when the URL has more', () => {
    expect(redactUrl(URL_MONIKERS.devnet)).toBe('https://api.devnet.solana.com');
    expect(redactUrl(URL_MONIKERS.localhost)).toBe('http://127.0.0.1:8899');
    expect(redactUrl('https://devnet.helius-rpc.com/?api-key=k')).toBe('https://devnet.helius-rpc.com/…');
    expect(redactUrl('https://solana-devnet.g.alchemy.com/v2/k')).toBe('https://solana-devnet.g.alchemy.com/…');
    expect(redactUrl('https://user:pass@rpc.example')).toBe('https://rpc.example/…');
  });

  it('replaces the URL as typed, as the CLI prints it, and its secret parts in any text', () => {
    const url = 'https://user:pw-secret@rpc.example/v2/path-secret?api-key=query-secret';
    const text = [
      url,
      new URL(url).href,
      'https://rpc.example/v2/path-secret?api-key=query-secret',
      'key api-key=query-secret',
      'path /v2/path-secret',
      'password pw-secret',
    ].join('\n');
    const redacted = redactText(text, url);
    for (const secret of ['path-secret', 'query-secret', 'pw-secret']) expect(redacted).not.toContain(secret);
    expect(redacted.split('\n')[0]).toBe('https://rpc.example/…');
  });

  it('leaves text alone when the URL hides nothing', () => {
    const text = 'Error: error sending request for url (http://127.0.0.1:8899/)';
    expect(redactText(text, URL_MONIKERS.localhost)).toBe(text);
    expect(redactText(text, URL_MONIKERS.devnet)).toBe(text);
  });
});
