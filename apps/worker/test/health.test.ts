import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const CSP =
  "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'";

function expectSecurityHeaders(res: Response) {
  expect(res.headers.get('Content-Security-Policy')).toBe(CSP);
  expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
  expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains');
}

describe('/api/health', () => {
  it('returns 200 JSON with the security headers', async () => {
    const res = await exports.default.fetch('https://stakeward.test/api/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/^application\/json/);
    const before = Date.now();
    const body = await res.json<{ ok: boolean; lastMonitorRunAt: string | null; now: string }>();
    expect(Object.keys(body).sort()).toEqual(['lastMonitorRunAt', 'now', 'ok']);
    expect(body).toMatchObject({ ok: true, lastMonitorRunAt: null });
    // The worker's clock, as ISO 8601 UTC.
    expect(body.now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Math.abs(Date.parse(body.now) - before)).toBeLessThan(60_000);
    expectSecurityHeaders(res);
  });

  it('unknown /api routes return a JSON 404 with the security headers', async () => {
    const res = await exports.default.fetch('https://stakeward.test/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
    expectSecurityHeaders(res);
  });
});
