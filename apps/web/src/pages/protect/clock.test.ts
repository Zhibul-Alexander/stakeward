import { describe, expect, it } from 'vitest';
import { clockSkew, clockSkewDetail, MAX_CLOCK_SKEW_SECONDS } from './clock.ts';

const NOW = 1_790_812_800n; // 1 October 2026, 00:00 UTC
const DAY = 86_400n;

describe('clockSkew (SECURITY-CHECK П12)', () => {
  it('allows up to one day between the network clock and this device, either way', () => {
    expect(MAX_CLOCK_SKEW_SECONDS).toBe(DAY);
    expect(clockSkew(NOW, NOW)).toBeNull();
    expect(clockSkew(NOW + DAY, NOW)).toBeNull();
    expect(clockSkew(NOW - DAY, NOW)).toBeNull();
    expect(clockSkew(NOW, NOW + 23n * 3_600n)).toBeNull();
  });

  it('refuses more than one day, ahead or behind', () => {
    expect(clockSkew(NOW + DAY + 1n, NOW)).toEqual({ network: NOW + DAY + 1n, device: NOW });
    expect(clockSkew(NOW - DAY - 1n, NOW)).toEqual({ network: NOW - DAY - 1n, device: NOW });
    // A worker that answers with a Clock from 2099: a lock until 2099 must never be offered.
    expect(clockSkew(4_070_908_800n, NOW)).not.toBeNull();
  });

  it('Details: both clocks as dates and unix seconds, the difference and the limit', () => {
    expect(clockSkewDetail({ network: NOW + 2n * DAY, device: NOW })).toBe(
      'Network clock: 3 October 2026, 00:00 UTC (unix 1790985600). Device clock: 1 October 2026, 00:00 UTC (unix 1790812800). ' +
        'They differ by 172800 seconds; at most 86400 are allowed.',
    );
  });
});
