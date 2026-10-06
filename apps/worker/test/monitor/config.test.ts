import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import {
  botUsernameOf,
  MONITOR_PLANS,
  monitorConfig,
  MonitorConfigError,
  siteOriginOf,
} from '../../src/monitor/config.ts';
import { FALLBACK_URL, MONITOR_URL, PRIMARY_URL } from '../fakes.ts';

/** The test environment with some values replaced (or removed with undefined), whatever their generated types say. */
function envWith(overrides: Record<string, string | undefined>): Env {
  const kept = Object.entries(env).filter(([name]) => !(name in overrides));
  const set = Object.entries(overrides).filter(([, value]) => value !== undefined);
  return Object.fromEntries([...kept, ...set]) as unknown as Env;
}

describe('monitorConfig', () => {
  it('reads the test environment (wrangler env dev + vitest bindings)', () => {
    expect(monitorConfig(env)).toEqual({
      cluster: 'devnet',
      plan: MONITOR_PLANS.free,
      siteOrigin: 'https://stakeward.test',
      telegramToken: '123456789:test-token',
      adminChatId: '700000001',
      rpc: { primary: PRIMARY_URL, fallback: undefined },
      rpcSecrets: { primary: 'RPC_URL', fallback: 'RPC_FALLBACK_URL' },
    });
    expect(monitorConfig(envWith({ RPC_FALLBACK_URL: FALLBACK_URL })).rpc).toEqual({ primary: PRIMARY_URL, fallback: FALLBACK_URL });
  });

  it('MONITOR_RPC_URL: the monitor reads through it, then RPC_FALLBACK_URL, else the site RPC_URL', () => {
    expect(monitorConfig(envWith({ MONITOR_RPC_URL: MONITOR_URL }))).toMatchObject({
      rpc: { primary: MONITOR_URL, fallback: PRIMARY_URL },
      rpcSecrets: { primary: 'MONITOR_RPC_URL', fallback: 'RPC_URL' },
    });
    expect(monitorConfig(envWith({ MONITOR_RPC_URL: MONITOR_URL, RPC_FALLBACK_URL: FALLBACK_URL }))).toMatchObject({
      rpc: { primary: MONITOR_URL, fallback: FALLBACK_URL },
      rpcSecrets: { primary: 'MONITOR_RPC_URL', fallback: 'RPC_FALLBACK_URL' },
    });
    // Empty (a cleared secret) is the same as not set.
    for (const empty of ['', undefined]) {
      expect(monitorConfig(envWith({ MONITOR_RPC_URL: empty, RPC_FALLBACK_URL: '' }))).toMatchObject({
        rpc: { primary: PRIMARY_URL, fallback: '' },
        rpcSecrets: { primary: 'RPC_URL', fallback: 'RPC_FALLBACK_URL' },
      });
      expect(monitorConfig(envWith({ MONITOR_RPC_URL: MONITOR_URL, RPC_FALLBACK_URL: empty })).rpc).toEqual({
        primary: MONITOR_URL,
        fallback: PRIMARY_URL,
      });
    }
  });

  it('picks the preset of MONITOR_PLAN; an unknown plan or cluster is a deploy bug', () => {
    expect(monitorConfig(envWith({ MONITOR_PLAN: 'paid', CLUSTER: 'mainnet' }))).toMatchObject({
      cluster: 'mainnet',
      plan: { name: 'paid', subrequestCap: 400, maxChunks: 5, decodeCap: 500 },
    });
    for (const overrides of [{ MONITOR_PLAN: 'Free' }, { MONITOR_PLAN: '' }, { MONITOR_PLAN: undefined }, { CLUSTER: 'testnet' }]) {
      expect(() => monitorConfig(envWith(overrides))).toThrow(MonitorConfigError);
    }
    // The pass logs and reports the error name only.
    let thrown: unknown;
    try {
      monitorConfig(envWith({ MONITOR_PLAN: 'enterprise' }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown instanceof Error ? thrown.name : thrown).toBe('MonitorConfigError');
  });

  it('the free preset fits the Workers Free limits; paid keeps the section 8 caps', () => {
    expect(MONITOR_PLANS.free.subrequestCap).toBeLessThan(50);
    expect(MONITOR_PLANS.paid.maxChunks).toBeLessThanOrEqual(5);
  });

  it('an empty bot token and an admin chat id that is not a number read as null', () => {
    expect(monitorConfig(envWith({ TELEGRAM_BOT_TOKEN: '' })).telegramToken).toBeNull();
    expect(monitorConfig(envWith({ TELEGRAM_BOT_TOKEN: undefined })).telegramToken).toBeNull();
    for (const id of ['-1001234567890', '42']) expect(monitorConfig(envWith({ ADMIN_CHAT_ID: id })).adminChatId).toBe(id);
    for (const id of ['', '@admin', '12a', '1'.repeat(21), ' 42', undefined]) {
      expect(monitorConfig(envWith({ ADMIN_CHAT_ID: id })).adminChatId).toBeNull();
    }
  });
});

describe('siteOriginOf', () => {
  it('accepts exactly an https origin', () => {
    for (const origin of ['https://stakeward.app', 'https://stakeward-dev.someone.workers.dev', 'https://localhost:8443']) {
      expect(siteOriginOf(envWith({ SITE_ORIGIN: origin }))).toBe(origin);
    }
  });

  it('rejects anything else', () => {
    for (const value of [
      '',
      'http://stakeward.app',
      'https://stakeward.app/',
      'https://stakeward.app/app',
      'https://stakeward.app?x=1',
      'https://user@stakeward.app',
      'HTTPS://STAKEWARD.APP',
      'stakeward.app',
      'javascript:alert(1)',
      undefined,
    ]) {
      expect(siteOriginOf(envWith({ SITE_ORIGIN: value }))).toBeNull();
    }
  });
});

describe('botUsernameOf', () => {
  it('a Telegram username without @, or null', () => {
    expect(botUsernameOf(env)).toBe('stakeward_test_bot');
    expect(botUsernameOf(envWith({ TELEGRAM_BOT_USERNAME: 'abcde' }))).toBe('abcde');
    for (const value of ['', '@stakeward_bot', 'abcd', 'a'.repeat(33), 'stake-ward', 'stake ward', undefined]) {
      expect(botUsernameOf(envWith({ TELEGRAM_BOT_USERNAME: value }))).toBeNull();
    }
  });
});
