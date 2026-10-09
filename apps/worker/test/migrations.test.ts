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

  type Column = { name: string; type: string; notnull: number; dflt_value: string | null };
  const columns = async (table: string) =>
    (
      await env.DB.prepare('SELECT name, type, "notnull", dflt_value FROM pragma_table_info(?1)').bind(table).all<Column>()
    ).results;

  it('0002 adds accounts.fingerprint (nullable TEXT) for the monitor fast path', async () => {
    expect((await columns('accounts')).find((c) => c.name === 'fingerprint')).toEqual({
      name: 'fingerprint',
      type: 'TEXT',
      notnull: 0,
      dflt_value: null,
    });
  });

  it('0003: events_pending is a partial index on events (id) for undelivered events', async () => {
    const index = await env.DB.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'events_pending'").first<{
      sql: string;
    }>();
    expect(index?.sql).toBe('CREATE INDEX events_pending ON events (id) WHERE notified_at IS NULL');
  });

  it('0004 drops the per-chat counts of meta.link_writes, which were kept under the chat id', async () => {
    const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0004_'));
    expect(migration).toBeDefined();
    const legacy = { day: '2026-10-06', n: 3, chats: { '1234567890': 2, '-1001234567890': 1 }, last: 'tok' };
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('link_writes', ?1), ('cursor', 'x')").bind(JSON.stringify(legacy)).run();
    for (const query of migration?.queries ?? []) await env.DB.prepare(query).run();
    const { results } = await env.DB.prepare('SELECT key, value FROM meta ORDER BY key').all<{ key: string; value: string }>();
    expect(results.map((row) => [row.key, row.key === 'link_writes' ? (JSON.parse(row.value) as unknown) : row.value])).toEqual([
      ['cursor', 'x'],
      ['link_writes', { day: '2026-10-06', n: 3, last: 'tok' }],
    ]);
  });

  it('0002 adds alert_links.last_event_id, INTEGER NOT NULL DEFAULT 0', async () => {
    expect((await columns('alert_links')).find((c) => c.name === 'last_event_id')).toEqual({
      name: 'last_event_id',
      type: 'INTEGER',
      notnull: 1,
      dflt_value: '0',
    });
    await env.DB.prepare('INSERT INTO alert_links (wallet, chat_id, created_at) VALUES (?1, ?2, ?3)').bind('W', '1', 1).run();
    const row = await env.DB.prepare('SELECT last_event_id FROM alert_links').first<{ last_event_id: number }>();
    expect(row?.last_event_id).toBe(0);
  });
});
