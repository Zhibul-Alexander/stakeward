import { describe, expect, it } from 'vitest';
import { fetchHealth, MONITOR_STALE_AFTER_MS, monitorFreshness, parseHealth } from './health.ts';

const answer = (status: number, body: unknown) => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('fetchHealth', () => {
  it('reads the last monitor pass from a 200 answer', async () => {
    const health = await fetchHealth({ fetch: answer(200, { ok: true, lastMonitorRunAt: '2026-10-02T12:00:00.000Z' }) });
    expect(health.lastMonitorRunAt?.toISOString()).toBe('2026-10-02T12:00:00.000Z');
  });

  it('reads the body of a 503 too: the worker answers 503 when the pass is stale', async () => {
    const health = await fetchHealth({ fetch: answer(503, { ok: false, lastMonitorRunAt: '2026-10-02T11:00:00.000Z' }) });
    expect(health.lastMonitorRunAt?.toISOString()).toBe('2026-10-02T11:00:00.000Z');
    expect(health.ok).toBe(false);
    // The status alone is the worker's verdict, whatever the body says.
    expect((await fetchHealth({ fetch: answer(503, { lastMonitorRunAt: null }) })).ok).toBe(false);
  });

  it("reads the worker's clock", async () => {
    const health = await fetchHealth({
      fetch: answer(200, { ok: true, lastMonitorRunAt: '2026-10-02T11:59:00.000Z', now: '2026-10-02T12:00:00.000Z' }),
    });
    expect(health).toEqual({
      ok: true,
      lastMonitorRunAt: new Date('2026-10-02T11:59:00.000Z'),
      serverTime: new Date('2026-10-02T12:00:00.000Z'),
    });
  });

  it('reports a monitor that has not run yet', async () => {
    expect(await fetchHealth({ fetch: answer(200, { ok: true, lastMonitorRunAt: null }) })).toEqual({ ok: true, lastMonitorRunAt: null });
  });

  it('asks the worker on its own origin', async () => {
    const urls: string[] = [];
    await fetchHealth({
      fetch: (input) => {
        urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        return answer(200, { ok: true, lastMonitorRunAt: null })();
      },
    });
    expect(urls).toEqual(['/api/health']);
  });

  it('rejects other statuses and malformed bodies', async () => {
    await expect(fetchHealth({ fetch: answer(404, { error: 'Not found' }) })).rejects.toThrow(/HTTP 404/);
    await expect(fetchHealth({ fetch: answer(200, { ok: true }) })).rejects.toThrow(/Malformed/);
    await expect(fetchHealth({ fetch: answer(200, { lastMonitorRunAt: 'yesterday' }) })).rejects.toThrow(/Malformed/);
    await expect(fetchHealth({ fetch: answer(200, { lastMonitorRunAt: 1_759_000_000 }) })).rejects.toThrow(/Malformed/);
    await expect(fetchHealth({ fetch: answer(200, { ok: 'yes', lastMonitorRunAt: null }) })).rejects.toThrow(/Malformed/);
    await expect(fetchHealth({ fetch: answer(200, { ok: true, lastMonitorRunAt: null, now: 'now' }) })).rejects.toThrow(/Malformed/);
  });

  it('gives up after the timeout (every wait is finite)', async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    await expect(fetchHealth({ fetch: hanging, timeoutMs: 10 })).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});

describe('parseHealth', () => {
  it('accepts null and ISO strings only', () => {
    expect(parseHealth({ lastMonitorRunAt: null })).toEqual({ lastMonitorRunAt: null });
    expect(() => parseHealth(null)).toThrow();
    expect(() => parseHealth('ok')).toThrow();
  });
});

describe('monitorFreshness', () => {
  const at = Date.parse('2026-10-02T12:00:00Z');
  const ran = (ageMs: number) => ({ lastMonitorRunAt: new Date(at - ageMs) });

  it('is stale only after 10 minutes', () => {
    expect(monitorFreshness(ran(MONITOR_STALE_AFTER_MS), at)).toEqual({ kind: 'checked', ageMs: MONITOR_STALE_AFTER_MS, stale: false });
    expect(monitorFreshness(ran(MONITOR_STALE_AFTER_MS + 1), at)).toMatchObject({ stale: true });
  });

  it('never shows a negative age when the local clock is behind', () => {
    expect(monitorFreshness(ran(-5_000), at)).toEqual({ kind: 'checked', ageMs: 0, stale: false });
  });

  it('has its own state before the first pass', () => {
    expect(monitorFreshness({ lastMonitorRunAt: null }, at)).toEqual({ kind: 'not-yet' });
  });

  it("takes the age from the worker's clock, plus the time since the answer", () => {
    const answered = at - 30_000;
    const health = { ok: true, lastMonitorRunAt: new Date(at - 120_000), serverTime: new Date(at - 60_000) };
    // The device clock is far off: only the time since the answer is measured with it.
    expect(monitorFreshness(health, at + 3_600_000, answered + 3_600_000)).toEqual({ kind: 'checked', ageMs: 90_000, stale: false });
    expect(monitorFreshness(health, answered + 9 * 60_000 + 1, answered)).toMatchObject({ stale: true });
  });

  it("follows the worker's verdict over the device clock, until the answer is 10 minutes old", () => {
    const fine = { ok: true, lastMonitorRunAt: new Date(at - 60 * 60_000) };
    expect(monitorFreshness(fine, at)).toMatchObject({ stale: false });
    expect(monitorFreshness(fine, at + MONITOR_STALE_AFTER_MS, at)).toMatchObject({ stale: false });
    expect(monitorFreshness(fine, at + MONITOR_STALE_AFTER_MS + 1, at)).toMatchObject({ stale: true });
    expect(monitorFreshness({ ok: false, lastMonitorRunAt: new Date(at + 60_000) }, at)).toMatchObject({ ageMs: 0, stale: true });
  });
});
