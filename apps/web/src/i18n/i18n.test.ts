import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@stakeward/core';
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
    expect(t('components.accountRow.label', { address: '7xK...9fQ' })).toBe('Stake account 7xK...9fQ');
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

  // UX rule 4: role names are Main key / Second key / New wallet; the program's words appear only in the FAQ's answers
  // (the landing page, landing.faq.<question>.answer.*) and on the recovery card. The product is never called a 2FA
  // wallet (CLAUDE.md section 1).
  it('uses the program words custodian/withdrawer/staker only in FAQ answers and recovery.*', () => {
    const allowed = /^(?:landing\.faq\.[^.]+\.answer\.|recovery\.)/;
    const offending = entries
      .filter(([key]) => !allowed.test(key))
      .filter(([, text]) => /custodian|withdrawer|staker/i.test(text))
      .map(([key]) => key);
    expect(offending).toEqual([]);
    // The answers do map the names to the command line's (positive control: the filter above is not vacuous).
    expect(en.landing.faq.lock.answer.names).toMatch(/withdrawer/);
    expect(en.landing.faq.lock.answer.what).toMatch(/custodian/);
  });

  // A lock held by the main key itself: the command line can act when the main key also signs as the lock's key. The
  // flag's name has the program's word, so the texts point to the command's --help, which names it (never a bare
  // command, which fails with LockupInForce or CustodianMissing).
  it('points the command line hints for locks Stakeward cannot handle to the option that makes them work', () => {
    expect(en.withdraw.unsupportedLock).toContain('solana withdraw-stake --help');
    expect(en.rescue.stake.unsupported).toContain('solana stake-authorize --help');
  });

  it('never calls the product a 2FA wallet', () => {
    expect(entries.filter(([, text]) => /2fa|two-factor/i.test(text)).map(([key]) => key)).toEqual([]);
  });
});

describe('errorMessage()', () => {
  // ERROR_CODES is every code core's translateError returns (UX rule 8): each needs its own text in en.json.
  it('has a text of its own for every core error code', () => {
    const errors = (en as { errors: Record<string, string> }).errors;
    for (const code of ERROR_CODES) {
      expect(errors[code], code).toEqual(expect.any(String));
      expect(errorMessage({ code }), code).not.toMatch(/^errors\./);
    }
    // The texts differ: no code borrows another one's sentence.
    const texts = ERROR_CODES.map((code) => errorMessage({ code }, 1_807_488_000n));
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('says until when a lock holds (UX rule 8)', () => {
    expect(errorMessage({ code: 'lockup-in-force' }, 1_807_488_000n)).toBe(
      'Locked until 12 April 2027: your second key must co-sign.',
    );
    expect(errorMessage({ code: 'lockup-in-force' })).toBe('This stake is locked: your second key must co-sign.');
  });
});
