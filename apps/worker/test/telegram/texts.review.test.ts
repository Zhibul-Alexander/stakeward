// Review (CLAUDE.md section 9, rule 4; step 5 spec section 8.3): the bot speaks of the main key and the second key
// like the site does. The chain role names appear only in the FAQ and the recovery card, never in a bot reply.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import {
  chatLinkBudgetText,
  helpText,
  kitAutoLabel,
  kitCardText,
  kitDeletedText,
  kitLinkedText,
  kitLinkInvalidText,
  kitsNoneText,
  linkedText,
  linkBudgetText,
  linkLimitText,
  moreAlertsText,
  notAnAddressText,
  stakeAccountsText,
  statusText,
  stopText,
} from '../../src/telegram/texts.ts';
import { key } from '../transactions.ts';

const ROLE_WORDS = /custodian|withdrawer|staker/i;
const NOW = Date.UTC(2026, 9, 5, 12);

function everyText(): string[] {
  const texts: string[] = [linkBudgetText(), chatLinkBudgetText(), linkLimitText(), stopText(), statusText([], null, NOW), moreAlertsText(1), moreAlertsText(95)];
  for (const origin of ['https://stakeward.test', null]) {
    texts.push(helpText(origin), notAnAddressText(origin));
    for (const watched of [0, 1, 2]) texts.push(linkedText(key(1), watched, origin));
  }
  const wallets = [
    { wallet: key(1), watched: 0 },
    { wallet: key(2), watched: 1 },
    { wallet: key(3), watched: 5 },
  ];
  texts.push(statusText(wallets, null, NOW), statusText(wallets, NOW - 125_000, NOW));
  // One-tap rescue kits (D118, D120).
  texts.push(kitLinkedText(key(9)), kitLinkInvalidText(), kitsNoneText());
  for (const origin of ['https://stakeward.test', null]) texts.push(kitDeletedText(key(9), origin));
  for (const auto of ['off', 'key-change', 'any-change'] as const) {
    texts.push(kitAutoLabel(auto), kitCardText({ stakeAccount: key(9), newWallet: key(4), status: 'ready', auto }));
  }
  return texts;
}

describe('review: bot texts', () => {
  it('no reply names a chain role', () => {
    const texts = everyText();
    expect(texts.length).toBeGreaterThan(10);
    for (const text of texts) expect(text).not.toMatch(ROLE_WORDS);
  });

  it('texts.ts holds no chain role name at all', () => {
    const source = env.TEST_WORKER_SOURCES['telegram/texts.ts'];
    expect(source).toBeDefined();
    expect(source).not.toMatch(ROLE_WORDS);
  });

  it('every reply that explains the bot says Stakeward never asks for the seed phrase', () => {
    for (const origin of ['https://stakeward.test', null]) {
      expect(helpText(origin)).toContain('Stakeward never asks for your seed phrase.');
      expect(linkedText(key(1), 1, origin)).toContain('Stakeward never asks for your seed phrase.');
    }
  });

  it('counts stake accounts in words', () => {
    expect(stakeAccountsText(0)).toBe('0 stake accounts');
    expect(stakeAccountsText(1)).toBe('1 stake account');
    expect(stakeAccountsText(2)).toBe('2 stake accounts');
  });

  it('plain text only: no Markdown or HTML markup in any reply', () => {
    for (const text of everyText()) expect(text).not.toMatch(/[<>*_`[\]]/);
  });
});
