import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('D1 migrations', () => {
  it('create the tables from CLAUDE.md section 8', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('accounts', 'events', 'alert_links', 'meta') ORDER BY name",
    ).all<{ name: string }>();
    expect(results.map((row) => row.name)).toEqual(['accounts', 'alert_links', 'events', 'meta']);
  });

  it('events reject a duplicate (stake_account, type, slot)', async () => {
    const insert = env.DB.prepare(
      'INSERT INTO events (stake_account, type, details_json, slot, detected_at) VALUES (?1, ?2, ?3, ?4, ?5)',
    );
    await insert.bind('Stake1', 'DEACTIVATED', '{}', 100, 1).run();
    await expect(insert.bind('Stake1', 'DEACTIVATED', '{}', 100, 2).run()).rejects.toThrow(/UNIQUE/);
    await insert.bind('Stake1', 'DEACTIVATED', '{}', 101, 3).run();

    const pending = await env.DB.prepare('SELECT COUNT(*) AS n FROM events WHERE notified_at IS NULL').first<{ n: number }>();
    expect(pending?.n).toBe(2);
  });

  it('alert_links keep one row per (wallet, chat_id)', async () => {
    const insert = env.DB.prepare(
      'INSERT INTO alert_links (wallet, chat_id, created_at) VALUES (?1, ?2, ?3) ON CONFLICT (wallet, chat_id) DO NOTHING',
    );
    await insert.bind('Wallet1', '42', 1).run();
    await insert.bind('Wallet1', '42', 2).run();
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM alert_links').first<{ n: number }>();
    expect(count?.n).toBe(1);
  });
});
