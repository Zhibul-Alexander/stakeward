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
    expect(await res.json()).toEqual({ ok: true, lastMonitorRunAt: null });
    expectSecurityHeaders(res);
  });

  it('unknown /api routes return a JSON 404 with the security headers', async () => {
    const res = await exports.default.fetch('https://stakeward.test/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
    expectSecurityHeaders(res);
  });
});
