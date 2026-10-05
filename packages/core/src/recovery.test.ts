import { describe, expect, it } from 'vitest';
import { rfc3339Utc } from './format.ts';
import {
  cliUrl,
  commandDisplayLines,
  commandLine,
  fillPlaceholders,
  INSTALL_CLI_COMMAND,
  LEDGER_PUBKEY_COMMAND,
  RECOVERY_CLI_VERSION,
  RECOVERY_PLACEHOLDERS,
  recoveryCommands,
  REMOVE_LOCK_DATE,
  type RecoveryCommandId,
} from './recovery.ts';

const MAIN = '7xKTg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgA9fQ';
const { stakeAccount, mainKey, secondKey, newWallet, newSecondKey, newEndDate } = RECOVERY_PLACEHOLDERS;

/** Spec step 8 section 2.1, word for word, with U = `url`. */
function specTable(url: string): Record<RecoveryCommandId, string> {
  return {
    find: `solana stakes --withdraw-authority ${MAIN} --url ${url}`,
    show: `solana stake-account <STAKE_ACCOUNT> --url ${url}`,
    epoch: `solana epoch-info --url ${url}`,
    rescue:
      'solana stake-authorize-checked <STAKE_ACCOUNT> --stake-authority <MAIN_KEY> --withdraw-authority <MAIN_KEY> ' +
      '--new-stake-authority <NEW_WALLET> --new-withdraw-authority <NEW_WALLET> --custodian <SECOND_KEY> ' +
      `--fee-payer <NEW_WALLET> --url ${url}`,
    deactivate: `solana deactivate-stake <STAKE_ACCOUNT> --stake-authority <MAIN_KEY> --fee-payer <MAIN_KEY> --url ${url}`,
    withdraw:
      'solana withdraw-stake <STAKE_ACCOUNT> <MAIN_KEY> ALL --withdraw-authority <MAIN_KEY> --custodian <SECOND_KEY> ' +
      `--fee-payer <MAIN_KEY> --url ${url}`,
    'withdraw-alone':
      'solana withdraw-stake <STAKE_ACCOUNT> <MAIN_KEY> ALL --withdraw-authority <MAIN_KEY> ' +
      `--fee-payer <MAIN_KEY> --url ${url}`,
    extend:
      'solana stake-set-lockup <STAKE_ACCOUNT> --lockup-date <NEW_END_DATE> --custodian <SECOND_KEY> ' +
      `--fee-payer <SECOND_KEY> --url ${url}`,
    'remove-lock':
      'solana stake-set-lockup <STAKE_ACCOUNT> --lockup-date 1970-01-01T00:00:00Z --custodian <SECOND_KEY> ' +
      `--fee-payer <SECOND_KEY> --url ${url}`,
    'change-second-key':
      'solana stake-set-lockup-checked <STAKE_ACCOUNT> --new-custodian <NEW_SECOND_KEY> --custodian <SECOND_KEY> ' +
      `--fee-payer <NEW_SECOND_KEY> --url ${url}`,
  };
}

const IDS = Object.keys(specTable('u')) as RecoveryCommandId[];
const READ_ONLY: readonly RecoveryCommandId[] = ['find', 'show', 'epoch'];
const SIGNING = IDS.filter((id) => !READ_ONLY.includes(id));
const commands = recoveryCommands({ mainKeyAddress: MAIN, url: cliUrl('mainnet') });

/** The value after `flag`, or undefined when the flag is missing. */
function flag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

describe('cliUrl', () => {
  it('maps each cluster to its CLI moniker', () => {
    expect(cliUrl('mainnet')).toBe('mainnet-beta');
    expect(cliUrl('devnet')).toBe('devnet');
  });
});

describe('recoveryCommands', () => {
  it.each(['mainnet', 'devnet'] as const)('gives the ten templates exactly as in the spec on %s', (cluster) => {
    const url = cliUrl(cluster);
    const expected = specTable(url);
    const actual = recoveryCommands({ mainKeyAddress: MAIN, url });
    expect(Object.keys(actual).sort()).toEqual([...IDS].sort());
    expect(IDS).toHaveLength(10);
    for (const id of IDS) {
      // No entry contains a space, so splitting the spec line gives the argv token by token.
      expect(actual[id], id).toEqual(expected[id].split(' '));
    }
  });

  it('starts every command with solana and ends it with --url <url>', () => {
    const custom = recoveryCommands({ mainKeyAddress: MAIN, url: 'http://127.0.0.1:8899' });
    for (const id of IDS) {
      expect(custom[id][0], id).toBe('solana');
      expect(custom[id].slice(-2), id).toEqual(['--url', 'http://127.0.0.1:8899']);
    }
  });

  it('gives every signing command a fee payer, and the read-only ones none', () => {
    for (const id of SIGNING) expect(flag(commands[id], '--fee-payer'), id).toBeDefined();
    for (const id of READ_ONLY) expect(commands[id], id).not.toContain('--fee-payer');
  });

  it('never lets a key that may be stolen pay', () => {
    expect(flag(commands.rescue, '--fee-payer')).toBe(newWallet);
    expect(flag(commands.rescue, '--fee-payer')).not.toBe(mainKey);
    expect(flag(commands.extend, '--fee-payer')).toBe(secondKey);
    expect(flag(commands['remove-lock'], '--fee-payer')).toBe(secondKey);
    expect(flag(commands['change-second-key'], '--fee-payer')).toBe(newSecondKey);
  });

  it('withdraws to the main key placeholder, not to a printed address', () => {
    expect(commands.withdraw[3]).toBe(mainKey);
    expect(commands['withdraw-alone'][3]).toBe(mainKey);
  });

  it('puts the main key address only into find', () => {
    for (const id of IDS) expect(commandLine(commands[id]).includes(MAIN), id).toBe(id === 'find');
  });

  it('has no prompt signer, default keypair or seed phrase flag', () => {
    for (const argv of [...IDS.map((id) => commands[id]), LEDGER_PUBKEY_COMMAND, INSTALL_CLI_COMMAND]) {
      const line = commandLine(argv);
      expect(line).not.toContain('ASK');
      expect(line).not.toContain('prompt:');
      for (const forbidden of ['-k', '--keypair', '--skip-seed-phrase-validation']) {
        expect(argv, line).not.toContain(forbidden);
      }
    }
  });

  it('rescues with stake-authorize-checked, both new authorities the new wallet and the second key co-signing', () => {
    expect(commands.rescue[1]).toBe('stake-authorize-checked');
    expect(flag(commands.rescue, '--new-stake-authority')).toBe(newWallet);
    expect(flag(commands.rescue, '--new-withdraw-authority')).toBe(newWallet);
    expect(flag(commands.rescue, '--custodian')).toBe(secondKey);
  });

  it('extends to the new end date and removes the lock with the unix epoch', () => {
    expect(flag(commands.extend, '--lockup-date')).toBe(newEndDate);
    expect(flag(commands['remove-lock'], '--lockup-date')).toBe(REMOVE_LOCK_DATE);
    expect(commands.show).toContain(stakeAccount);
  });
});

describe('static commands', () => {
  it('quotes the Ledger URL with double quotes', () => {
    expect(commandLine(LEDGER_PUBKEY_COMMAND)).toBe('solana-keygen pubkey "usb://ledger?key=0"');
  });

  it('pins the installer to the tested CLI release', () => {
    expect(RECOVERY_CLI_VERSION).toBe('4.3.0');
    expect(commandLine(INSTALL_CLI_COMMAND)).toBe('sh -c "$(curl -sSfL https://release.anza.xyz/v4.3.0/install)"');
  });
});

describe('commandLine and commandDisplayLines', () => {
  /** What bash and zsh read from the display form: line continuations removed, words split on whitespace. */
  function shellWords(lines: readonly string[]): string[] {
    return lines.join('\n').replace(/\\\n/g, '').trim().split(/\s+/);
  }

  it('joins argv with single spaces', () => {
    expect(commandLine(['solana', 'epoch-info', '--url', 'devnet'])).toBe('solana epoch-info --url devnet');
    expect(commandLine(commands.withdraw)).not.toMatch(/ {2}/);
  });

  it('shows withdraw on 8 lines, the first 7 ending with " \\"', () => {
    const lines = commandDisplayLines(commands.withdraw);
    expect(lines).toEqual([
      'solana withdraw-stake \\',
      '  <STAKE_ACCOUNT> \\',
      '  <MAIN_KEY> \\',
      '  ALL \\',
      '  --withdraw-authority <MAIN_KEY> \\',
      '  --custodian <SECOND_KEY> \\',
      '  --fee-payer <MAIN_KEY> \\',
      '  --url mainnet-beta',
    ]);
    expect(lines.slice(0, 7).every((line) => line.endsWith(' \\'))).toBe(true);
    expect(lines[7]?.endsWith('\\')).toBe(false);
  });

  it('shows the Ledger and install commands on one line', () => {
    expect(commandDisplayLines(LEDGER_PUBKEY_COMMAND)).toEqual([commandLine(LEDGER_PUBKEY_COMMAND)]);
    expect(commandDisplayLines(INSTALL_CLI_COMMAND)).toEqual([commandLine(INSTALL_CLI_COMMAND)]);
  });

  it.each(IDS)('gives back the command line of %s once " \\" and the line breaks are removed', (id) => {
    const lines = commandDisplayLines(commands[id]);
    const joined = lines.map((line) => line.replace(/ \\$/, '').trim()).join(' ');
    expect(joined).toBe(commandLine(commands[id]));
    expect(shellWords(lines)).toEqual(commands[id]);
  });
});

describe('fillPlaceholders', () => {
  it('replaces placeholders with their values and leaves everything else alone', () => {
    const argv = commands.withdraw;
    const filled = fillPlaceholders(argv, {
      [stakeAccount]: '"/keys/stake.json"',
      [mainKey]: '"/keys/main.json"',
      [secondKey]: '"usb://ledger?key=1"',
    });
    expect(filled).toEqual([
      'solana',
      'withdraw-stake',
      '"/keys/stake.json"',
      '"/keys/main.json"',
      'ALL',
      '--withdraw-authority',
      '"/keys/main.json"',
      '--custodian',
      '"usb://ledger?key=1"',
      '--fee-payer',
      '"/keys/main.json"',
      '--url',
      'mainnet-beta',
    ]);
    expect(argv[2]).toBe(stakeAccount); // the template is not changed
  });

  it('leaves a placeholder without a value in place', () => {
    expect(fillPlaceholders(commands.extend, { [secondKey]: 'k.json' })).toContain(newEndDate);
  });

  it('only replaces whole entries that are placeholders', () => {
    const argv = ['x<MAIN_KEY>', '<MAIN_KEY>y', 'toString', '<main_key>', 'ALL'];
    expect(fillPlaceholders(argv, { [mainKey]: 'main.json' })).toEqual(argv);
  });
});

describe('REMOVE_LOCK_DATE', () => {
  it('is the unix epoch in RFC 3339, which SetLockup writes as unixTimestamp 0', () => {
    expect(Date.parse(REMOVE_LOCK_DATE)).toBe(0);
    expect(rfc3339Utc(0n)).toBe(REMOVE_LOCK_DATE);
  });
});
