import { formatSol, RECOVERY_CLI_VERSION, REMINDER_DAYS } from '@stakeward/core';
import type { Load } from '@/hooks/use-load';
import type { Messages } from '@/i18n';
import { MAX_RESCUE_ACCOUNTS, SUGGESTED_RESCUE_LAMPORTS } from '@/pages/rescue/wizard';
import { depositText } from './deposit.ts';

/** The questions of the landing FAQ (en.json `faq.items`, top level: the program's words are allowed there, D81). */
export type FaqId = keyof Messages['faq']['items'];
export type FaqGroupId = keyof Messages['faq']['groups'];

/** Every question once, in reading order, under its group heading (test/landing.test.tsx checks "every" and "once"). */
export const FAQ_GROUPS: readonly { id: FaqGroupId; items: readonly FaqId[] }[] = [
  { id: 'basics', items: ['what', 'custody', 'rewards', 'wallet-app', 'lock-ends', 'period', 'thefts'] },
  {
    id: 'keys',
    items: [
      'good-second-key',
      'different-seed',
      'someone-else',
      'main-stolen',
      'main-lost',
      'second-lost',
      'second-stolen',
      'both-stolen',
      'change-second-key',
      'locked-by-other',
      'fake-site',
      'check-explorer',
    ],
  },
  { id: 'signing', items: ['ledger', 'wallet-warning', 'co-sign', 'phone', 'many-accounts', 'staking-service'] },
  { id: 'costs', items: ['free', 'deposit', 'privacy', 'stop-alerts'] },
  { id: 'developers', items: ['on-chain', 'existing-accounts', 'terms', 'cli', 'programs', 'audit'] },
];

/**
 * Answers with more than text: the Ledger's fields (`ledger`), a link to the gate results (`gate-link`), a link to
 * Rescue (`rescue-link`).
 */
export const FAQ_EXTRAS: Partial<Record<FaqId, 'ledger' | 'gate-link' | 'rescue-link'>> = {
  ledger: 'ledger',
  'existing-accounts': 'gate-link',
  'main-stolen': 'rescue-link',
};

/** The reminder days as a sentence fragment: "30, 14, 7, 3, and 1" (core REMINDER_DAYS, the worker's thresholds). */
export const REMINDER_DAYS_TEXT = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(REMINDER_DAYS.map(String));

/**
 * One params object for every FAQ answer and for landing.alerts.events.reminders. Numbers come from code and the
 * network, never from en.json: `days` (REMINDER_DAYS), `deposit` (read from the network, neutral words until then),
 * `rescueAmount` (what the rescue wizard suggests), `rescueMax` (stake accounts one rescue run moves) and `version`
 * (the Solana CLI the recovery card was run with).
 */
export function useFaqParams(deposit: Load<bigint>): Record<string, string> {
  return {
    days: REMINDER_DAYS_TEXT,
    deposit: depositText(deposit),
    rescueAmount: formatSol(SUGGESTED_RESCUE_LAMPORTS),
    rescueMax: String(MAX_RESCUE_ACCOUNTS),
    version: RECOVERY_CLI_VERSION,
  };
}
