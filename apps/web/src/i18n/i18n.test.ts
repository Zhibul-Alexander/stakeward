import { describe, expect, it } from 'vitest';
import type { ErrorCode } from '@stakeward/core';
import en from './en.json';
import { errorMessage } from './errors.ts';
import { t } from './index.ts';

function leaves(node: unknown, prefix = ''): [string, string][] {
  if (typeof node === 'string') return [[prefix, node]];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leaves(value, prefix === '' ? key : `${prefix}.${key}`),
  );
}

describe('t()', () => {
  it('reads nested keys and fills placeholders', () => {
    expect(t('common.roles.second')).toBe('Second key');
    expect(t('status.lockedByOtherHint', { address: '7xK...9fQ' })).toBe(
      'The second key is 7xK...9fQ. Connect it if it is yours.',
    );
    expect(t('errors.lockup-in-force', { date: '12 April 2027' })).toBe(
      'Locked until 12 April 2027: your second key must co-sign.',
    );
  });

  it('leaves a placeholder visible when its parameter is missing', () => {
    expect(t('status.lockedUntil')).toBe('Locked until {date}');
  });
});

describe('en.json', () => {
  const entries = leaves(en);

  it('has no empty strings', () => {
    expect(entries.filter(([, text]) => text.trim() === '').map(([key]) => key)).toEqual([]);
  });

  // UX rule 4: role names are Main key / Second key / New wallet; the program's words appear only in the FAQ and
  // on the recovery card. The product is never called a 2FA wallet (CLAUDE.md section 1).
  it('uses the program words custodian/withdrawer/staker only in faq.* and recovery.*', () => {
    const offending = entries
      .filter(([key]) => !key.startsWith('faq.') && !key.startsWith('recovery.'))
      .filter(([, text]) => /custodian|withdrawer|staker/i.test(text))
      .map(([key]) => key);
    expect(offending).toEqual([]);
  });

  it('never calls the product a 2FA wallet', () => {
    expect(entries.filter(([, text]) => /2fa|two-factor/i.test(text)).map(([key]) => key)).toEqual([]);
  });
});

describe('errorMessage()', () => {
  const codes: ErrorCode[] = [
    'lockup-in-force',
    'custodian-missing',
    'custodian-signature-missing',
    'already-deactivated',
    'too-soon-to-redelegate',
    'insufficient-delegation',
    'merge-mismatch',
    'missing-signature',
    'insufficient-funds',
    'blockhash-expired',
    'nonce-advanced',
    'already-processed',
    'wallet-rejected',
    'network',
    'unknown',
  ];

  it('has a text for every core error code', () => {
    for (const code of codes) expect(errorMessage({ code }), code).not.toMatch(/^errors\./);
  });

  it('says until when a lock holds (UX rule 8)', () => {
    expect(errorMessage({ code: 'lockup-in-force' }, 1_807_488_000n)).toBe(
      'Locked until 12 April 2027: your second key must co-sign.',
    );
    expect(errorMessage({ code: 'lockup-in-force' })).toBe('This stake is locked: your second key must co-sign.');
  });
});
