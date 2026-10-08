import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import {
  LEDGER_CHECKED_ON,
  LEDGER_SCREENS,
  matrixDateText,
  WALLET_MATRIX_DATE,
  WALLET_PAIRS,
  type LedgerField,
} from './wallet-support.ts';

// The landing's wallet table and Ledger list are data the wallet matrix fills (DECISIONS.md D80). Until it has run, the
// page may claim nothing: every verdict is "Not verified yet" (CLAUDE.md section 9 rule П10).
describe('wallet support data', () => {
  it('has unique pair ids made of the two setups', () => {
    const ids = WALLET_PAIRS.map((pair) => pair.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const pair of WALLET_PAIRS) expect(pair.id).toBe(`${pair.main}+${pair.second}`);
  });

  it('lists only the pair the wallet matrix runs: two Phantom accounts (TESTPLAN step 3; no Solflare, Backpack or Ledger)', () => {
    expect(WALLET_PAIRS.map((pair) => pair.id)).toEqual(['phantom+phantom-imported']);
  });

  it('Phantom with Phantom: works in one browser after its warnings; by link not verified before the phone run (D110)', () => {
    expect(WALLET_MATRIX_DATE).toBe('2026-10-08');
    expect(WALLET_PAIRS[0]).toMatchObject({ here: 'works-with-warning', link: 'not-verified', note: 'authority-warning' });
  });

  it('claims nothing before the matrix has run', () => {
    if (WALLET_MATRIX_DATE !== null) {
      expect(matrixDateText(WALLET_MATRIX_DATE)).not.toBeNull();
      return;
    }
    for (const pair of WALLET_PAIRS) {
      expect([pair.id, pair.here, pair.link, pair.note]).toEqual([pair.id, 'not-verified', 'not-verified', null]);
    }
  });

  it('writes the matrix date the way the site writes dates', () => {
    expect(matrixDateText('2026-10-06')).toBe('6 October 2026');
    expect(matrixDateText('2027-01-31')).toBe('31 January 2027');
    expect(matrixDateText(null)).toBeNull();
    expect(matrixDateText('2026-13-01')).toBeNull();
    expect(matrixDateText('2026-02-30')).toBeNull();
    expect(matrixDateText('6.10.2026')).toBeNull();
    expect(matrixDateText('2026-10-06T00:00:00Z')).toBeNull();
  });

  it('dates the Ledger list only with a real date', () => {
    if (LEDGER_CHECKED_ON !== null) expect(matrixDateText(LEDGER_CHECKED_ON)).not.toBeNull();
  });

  it('shows every Ledger field en.json explains, under some action', () => {
    const shown = new Set(LEDGER_SCREENS.flatMap((screen) => screen.fields));
    const explained = Object.keys(en.faq.ledger.fields) as LedgerField[];
    expect(explained.filter((field) => !shown.has(field))).toEqual([]);
    expect(LEDGER_SCREENS.map((screen) => screen.action)).toEqual(Object.keys(en.faq.ledger.actions));
  });
});
