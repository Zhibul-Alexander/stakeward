import { formatUtcDate } from '@stakeward/core';
import type { SupportVerdict } from '@/components/product/support-badge';
import type { Messages } from '@/i18n';

/**
 * What the landing page says about wallets and the Ledger (DECISIONS.md D80). Data, not copy: the wallet matrix (TESTPLAN
 * step 3) fills it in later with no component change. Without a matrix date every verdict stays `not-verified`
 * (wallet-support.test.ts).
 *
 * Filling rules, after a matrix run:
 * 1. Set WALLET_MATRIX_DATE.
 * 2. Set `here` from the blockhash runs, in the order the signing order actually uses.
 * 3. Set `link` only from a second-device run (a phone or another computer opening /cosign). A one-browser nonce run
 *    leaves it `not-verified` with the note `link-same-browser`.
 * 4. works: landed with no warning; works-with-warning: landed after a wallet warning; blind-signing: the Ledger asked
 *    for blind signing; does-not-work: could not finish.
 * 5. Pick a note, or add one under landing.wallets.notes in en.json.
 * 6. Set LEDGER_CHECKED_ON only if a device showed exactly the fields below; otherwise edit LEDGER_SCREENS.
 * 7. Then edit the hedged sentences faq.items.ledger.a and faq.ledger.phantom in en.json to match, and after a Ledger run
 *    faq.ledger.fromSource, faq.items.good-second-key.a and faq.items.fake-site.a too.
 * 8. A wallet that gets a pair is no longer "not tested": edit landing.wallets.intro.
 */

export type WalletSetup = keyof Messages['landing']['wallets']['setups'];
export type WalletNote = keyof Messages['landing']['wallets']['notes'];

/** One pair of wallets: the main key's and the second key's, and how signing went with both in one browser and by link. */
export type PairSupport = {
  id: string;
  main: WalletSetup;
  second: WalletSetup;
  here: SupportVerdict;
  link: SupportVerdict;
  note: WalletNote | null;
};

/** UTC 'YYYY-MM-DD' of the wallet matrix run (TESTPLAN step 3). Null: not run. */
export const WALLET_MATRIX_DATE: string | null = '2026-10-08';

/**
 * The pairs the wallet matrix runs (TESTPLAN step 3). Only two Phantom accounts: the owner has no Solflare, Backpack or
 * Ledger to test with (05.10.2026), so the table lists no pair that no one will run, and the intro says those wallets
 * are not tested. A pair goes in when a run of it is planned.
 *
 * Phantom + Phantom, 08.10.2026 on devnet: all four one-browser runs landed unchanged, after Phantom's warnings "This
 * transaction could steal your funds in the future" and "This domain is new" (D110). Signing by link stays not verified
 * until the phone run (TESTPLAN stage 4).
 */
export const WALLET_PAIRS: readonly PairSupport[] = [
  {
    id: 'phantom+phantom-imported',
    main: 'phantom',
    second: 'phantom-imported',
    here: 'works-with-warning',
    link: 'not-verified',
    note: 'authority-warning',
  },
];

export type LedgerField = keyof Messages['faq']['ledger']['fields'];
export type LedgerAction = keyof Messages['faq']['ledger']['actions'];

/**
 * The fields a Ledger should show for each kind of transaction, from LedgerHQ/app-solana develop
 * (libsol/stake_instruction.c, transaction_printers.c), 05.10.2026. Removing a lock shows a Time in 1970.
 */
export const LEDGER_SCREENS: readonly { action: LedgerAction; fields: readonly LedgerField[] }[] = [
  { action: 'protect', fields: ['set-lockup', 'time', 'new-authority'] },
  { action: 'extend', fields: ['set-lockup', 'time'] },
  { action: 'withdraw', fields: ['amount', 'from-stake-account', 'to'] },
  { action: 'rescue', fields: ['set-stake-auth', 'new-authorities', 'custodian'] },
  { action: 'nonce-setup', fields: ['create-nonce-acct'] },
];

/** UTC 'YYYY-MM-DD' a real Ledger showed the fields above. Null: known from the source code only. */
export const LEDGER_CHECKED_ON: string | null = null;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * '2026-10-06' -> '6 October 2026' (core formatUtcDate, as every other date on the site); null for null or anything
 * that is not a real calendar date in that form.
 */
export function matrixDateText(date: string | null): string | null {
  if (date === null) return null;
  const match = ISO_DATE.exec(date);
  if (match === null) return null;
  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  const value = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC rolls 2026-13-01 over into 2027; a real date reads back the same.
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return null;
  return formatUtcDate(BigInt(value.getTime() / 1000));
}
