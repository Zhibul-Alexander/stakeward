import { getAddressDecoder, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { alertLinkPath, parseAlertLink } from './alert-link.ts';

const key = (n: number): Address => getAddressDecoder().decode(new Uint8Array(32).fill(n));
const STAKE = key(9);
const MAIN = key(1);

describe('alertLinkPath', () => {
  it('adds the event and the stake account to a path with or without a query', () => {
    expect(alertLinkPath(`/rescue?address=${MAIN}`, { event: 'DEACTIVATED', stake: STAKE })).toBe(
      `/rescue?address=${MAIN}&event=DEACTIVATED&stake=${STAKE}`,
    );
    expect(alertLinkPath(`/extend/${STAKE}`, { event: 'REMINDER_7', stake: STAKE })).toBe(
      `/extend/${STAKE}?event=REMINDER_7&stake=${STAKE}`,
    );
    expect(alertLinkPath('/app#x', { event: 'EXPIRED', stake: STAKE })).toBe(`/app?event=EXPIRED&stake=${STAKE}#x`);
  });

  it('refuses something that is not an event type', () => {
    expect(() => alertLinkPath('/app', { event: 'x&y=1', stake: STAKE })).toThrow();
  });
});

describe('parseAlertLink', () => {
  it('reads back what alertLinkPath wrote', () => {
    const path = alertLinkPath(`/app?address=${MAIN}`, { event: 'STAKER_CHANGED', stake: STAKE });
    expect(parseAlertLink(path.slice(path.indexOf('?')))).toEqual({ event: 'STAKER_CHANGED', stake: STAKE });
  });

  it.each([
    ['no parameters', ''],
    ['no stake', '?event=DEACTIVATED'],
    ['no event', `?stake=${STAKE}`],
    ['a stake that is not an address', '?event=DEACTIVATED&stake=abc'],
    ['an event in lower case', `?event=deactivated&stake=${STAKE}`],
    ['an event with markup', `?event=%3Cb%3E&stake=${STAKE}`],
  ])('null for %s', (_name, search) => {
    expect(parseAlertLink(search)).toBeNull();
  });
});
