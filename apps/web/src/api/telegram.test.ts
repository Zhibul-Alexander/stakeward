import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { telegramLinkPath } from './telegram.ts';

describe('telegramLinkPath', () => {
  it("points at the worker's redirect to the bot, on this origin, with the wallet as the start parameter", () => {
    const wallet = address('B1agBSrGRgub2jXMJEozYkRLRzFc9HLd5hHjSrCtuXu8');
    expect(telegramLinkPath(wallet)).toBe('/api/telegram/link?wallet=B1agBSrGRgub2jXMJEozYkRLRzFc9HLd5hHjSrCtuXu8');
    // A base58 address needs no escaping in a query string.
    expect(new URL(telegramLinkPath(wallet), 'https://stakeward.example').searchParams.get('wallet')).toBe(wallet);
  });
});
