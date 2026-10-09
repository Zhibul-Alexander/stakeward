// GET /api/health (step 5 spec section 9, DECISIONS.md D38): the age of the last successful monitor pass. 503 without
// a marker or with one older than 10 minutes, 500 when D1 fails; exactly the keys ok, lastMonitorRunAt and now.
import { env, exports } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeUpstream, SECURITY_HEADERS, securityHeadersOf, testApp } from './fakes.ts';

const NOW = Date.UTC(2026, 9, 5, 12);

type Health = { ok: boolean; lastMonitorRunAt: string | null; now: string };

function api() {
  return testApp(
    fakeUpstream(() => {
      throw new Error('health never calls the RPC');
    }),
    { now: () => NOW },
  );
}

async function setMarker(ms: number): Promise<void> {
  await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_pass_at', ?1)").bind(String(ms)).run();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('/api/health', () => {
  it('503 {ok: false, lastMonitorRunAt: null} while no monitor pass has succeeded', async () => {
    const res = await api().request('/api/health');
    expect(res.status).toBe(503);
    expect(res.headers.get('Content-Type')).toMatch(/^application\/json/);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json<Health>();
    expect(Object.keys(body).sort()).toEqual(['lastMonitorRunAt', 'now', 'ok']);
    expect(body).toEqual({ ok: false, lastMonitorRunAt: null, now: '2026-10-05T12:00:00.000Z' });
    expect(securityHeadersOf(res)).toEqual(SECURITY_HEADERS);
  });

  it('200 ok with a marker 9:59 old, 503 at 10:01, both with the marker time', async () => {
    await setMarker(NOW - 599_000);
    const fresh = await api().request('/api/health');
    expect(fresh.status).toBe(200);
    expect(await fresh.json<Health>()).toEqual({
      ok: true,
      lastMonitorRunAt: '2026-10-05T11:50:01.000Z',
      now: '2026-10-05T12:00:00.000Z',
    });
    expect(securityHeadersOf(fresh)).toEqual(SECURITY_HEADERS);

    await setMarker(NOW - 601_000);
    const stale = await api().request('/api/health');
    expect(stale.status).toBe(503);
    const body = await stale.json<Health>();
    expect(Object.keys(body).sort()).toEqual(['lastMonitorRunAt', 'now', 'ok']);
    expect(body).toEqual({ ok: false, lastMonitorRunAt: '2026-10-05T11:49:59.000Z', now: '2026-10-05T12:00:00.000Z' });
    expect(securityHeadersOf(stale)).toEqual(SECURITY_HEADERS);
  });

  it('exactly 10 minutes is still ok', async () => {
    await setMarker(NOW - 600_000);
    expect((await api().request('/api/health')).status).toBe(200);
  });

  it('a marker that is not a time reads as none', async () => {
    for (const value of ['', 'soon', '-5', '1.5', '99999999999999999']) {
      await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_pass_at', ?1)").bind(value).run();
      const res = await api().request('/api/health');
      expect(res.status, value).toBe(503);
      expect((await res.json<Health>()).lastMonitorRunAt, value).toBeNull();
    }
  });

  it('500 with the security headers when D1 fails, never a stale answer', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await env.DB.exec('DROP TABLE meta');
    const res = await api().request('/api/health');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal error' });
    expect(securityHeadersOf(res)).toEqual(SECURITY_HEADERS);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('the deployed entry point answers from the worker clock', async () => {
    await setMarker(Date.now() - 60_000);
    const before = Date.now();
    const res = await exports.default.fetch('https://stakeward.test/api/health');
    expect(res.status).toBe(200);
    const body = await res.json<Health>();
    expect(body.ok).toBe(true);
    // The worker's clock, as ISO 8601 UTC.
    expect(body.now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Math.abs(Date.parse(body.now) - before)).toBeLessThan(60_000);
    expect(securityHeadersOf(res)).toEqual(SECURITY_HEADERS);
  });

  it('unknown /api routes return a JSON 404 with the security headers', async () => {
    const res = await exports.default.fetch('https://stakeward.test/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
    expect(securityHeadersOf(res)).toEqual(SECURITY_HEADERS);
  });
});
