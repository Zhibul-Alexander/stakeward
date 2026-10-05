import { describe, expect, it } from 'vitest';
import { ADMIN_KINDS, adminAllowed, adminKindToSend, adminText, parseAdminAlerts, safeErrorName } from '../../src/monitor/admin.ts';

const HOUR = 3_600_000;

describe('admin alerts', () => {
  it('texts name the cluster and counts only', () => {
    expect(adminText('pass-error', 'mainnet', { stage: 'chunks', errorName: 'TypeError' })).toBe(
      'Stakeward mainnet monitor: the pass failed at chunks (TypeError). Health turns red after 10 minutes. See Workers Logs.',
    );
    expect(adminText('rpc-down', 'devnet', { passes: 4 })).toBe(
      'Stakeward devnet monitor: the RPC could not be read for 4 passes in a row. Health turns red after 10 minutes.',
    );
    expect(adminText('rescan-dropped', 'devnet', { kb: 100 })).toBe('Stakeward devnet monitor: a rescan answer over 100 KB was skipped.');
    // CLUSTER itself broken: the monitor without a cluster name.
    expect(adminText('pass-error', null, { stage: 'config', errorName: 'MonitorConfigError' })).toMatch(
      /^Stakeward monitor: the pass failed at config \(MonitorConfigError\)\./,
    );
    for (const kind of ADMIN_KINDS) expect(adminText(kind, 'devnet', {})).not.toMatch(/https?:|undefined/);
  });

  it('an error name that is not a plain identifier is not passed on', () => {
    expect(safeErrorName('D1_ERROR')).toBe('D1_ERROR');
    expect(safeErrorName('Error: https://rpc.example/?api-key=secret')).toBe('Error');
    expect(safeErrorName('')).toBe('Error');
    expect(safeErrorName(undefined)).toBe('Error');
  });

  it('one per kind per hour', () => {
    const sent = { 'pass-error': 1_000 };
    expect(adminAllowed('pass-error', sent, 1_000 + HOUR - 1)).toBe(false);
    expect(adminAllowed('pass-error', sent, 1_000 + HOUR)).toBe(true);
    expect(adminAllowed('pass-died', sent, 1_001)).toBe(true);
  });

  it('one alert a pass: the first due by priority (pass-error, wrong-cluster, pass-died, rpc-down, rescan-dropped)', () => {
    const now = 10 * HOUR;
    expect(adminKindToSend(new Set(['rescan-dropped', 'rpc-down', 'pass-died'] as const), {}, now)).toBe('pass-died');
    expect(adminKindToSend(new Set(['rescan-dropped', 'wrong-cluster'] as const), {}, now)).toBe('wrong-cluster');
    // A kind sent within the hour gives way to the next one due.
    expect(adminKindToSend(new Set(['pass-died', 'rpc-down'] as const), { 'pass-died': now - 60_000 }, now)).toBe('rpc-down');
    expect(adminKindToSend(new Set(['pass-died'] as const), { 'pass-died': now - 60_000 }, now)).toBeNull();
    expect(adminKindToSend(new Set(), {}, now)).toBeNull();
  });

  it('meta.admin_alerts: known kinds with integer times; anything else reads as nothing sent', () => {
    expect(parseAdminAlerts('{"pass-error":5,"rpc-down":"6","other":7}')).toEqual({ 'pass-error': 5 });
    for (const text of [undefined, '', 'nope', '[]', 'null', '{"pass-error":1.5}']) expect(parseAdminAlerts(text)).toEqual({});
  });
});
