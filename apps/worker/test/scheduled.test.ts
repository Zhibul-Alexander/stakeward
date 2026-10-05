// The deployed cron entry point: src/index.ts default.scheduled runs one monitor pass with the real deps.
import { createScheduledController } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

async function meta(): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare('SELECT key, value FROM meta').all<{ key: string; value: string }>();
  return Object.fromEntries(results.map((row) => [row.key, row.value]));
}

describe('scheduled', () => {
  it('on an empty database: one pass, the marker written, noRetry called, no fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('no network in this test'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const controller = createScheduledController({ scheduledTime: Date.now(), cron: '*/2 * * * *' });
    const noRetry = vi.spyOn(controller, 'noRetry');
    const before = Date.now();

    await worker.scheduled(controller, env);

    expect(noRetry).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    const marker = Number((await meta()).last_pass_at);
    expect(marker).toBeGreaterThanOrEqual(before);
    expect(marker).toBeLessThanOrEqual(Date.now());
    const line = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as Record<string, unknown>;
    expect(line).toMatchObject({ msg: 'monitor pass', cluster: 'devnet', outcome: 'ok', rows: 0 });
  });

  it('a failing pass: noRetry first, one admin alert through the global fetch, the invocation rejected', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true, result: {} }));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const controller = createScheduledController({ scheduledTime: Date.now(), cron: '*/2 * * * *' });
    const noRetry = vi.spyOn(controller, 'noRetry');
    const broken = { ...env, MONITOR_PLAN: 'enterprise' } as unknown as Env;

    await expect(worker.scheduled(controller, broken)).rejects.toThrow('unknown MONITOR_PLAN');

    expect(noRetry).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('https://api.telegram.org/bot123456789:test-token/sendMessage');
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '') as { chat_id: string; text: string };
    expect(body).toMatchObject({ chat_id: '700000001', text: expect.stringContaining('failed at config (MonitorConfigError)') as unknown });
    expect(await meta()).toEqual({});
    // Logged without the message, the token or the chat id.
    const logged = error.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    expect(logged).toContain('monitor pass failed');
    expect(logged).not.toMatch(/unknown MONITOR_PLAN|test-token|700000001/);
  });
});
