import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { attemptPost } from '../../src/upstream.ts';
import { BudgetExhaustedError, COST, PassBudget } from '../../src/monitor/budget.ts';

const ok: typeof fetch = () => Promise.resolve(new Response('{}'));

describe('PassBudget', () => {
  it('counts fetches and statements together, one fetch and one statement held back from the start', async () => {
    const budget = new PassBudget(10, ok);
    expect(budget.left()).toBe(8);
    await budget.fetch('https://x.test/');
    await budget.batch(env.DB, [env.DB.prepare('SELECT 1'), env.DB.prepare('SELECT 2')]);
    expect(budget.used).toEqual({ fetches: 1, statements: 2 });
    expect(budget.left()).toBe(5);
  });

  it('a batch past the cap throws before it runs; the reserves free one statement and one fetch each', async () => {
    const budget = new PassBudget(4, ok);
    await budget.batch(env.DB, [env.DB.prepare('SELECT 1'), env.DB.prepare('SELECT 2')]);
    expect(budget.left()).toBe(0);
    await expect(budget.batch(env.DB, [env.DB.prepare('SELECT 3')])).rejects.toThrow(BudgetExhaustedError);
    expect(budget.used.statements).toBe(2);

    budget.release('finish');
    await budget.batch(env.DB, [env.DB.prepare('SELECT 3')]);
    await expect(budget.fetch('https://x.test/')).rejects.toThrow(BudgetExhaustedError);
    budget.release('admin');
    expect((await budget.fetch('https://x.test/')).ok).toBe(true);
    expect(budget.used).toEqual({ fetches: 1, statements: 3 });
    expect(budget.left()).toBe(0);
  });

  it('a fetch past the cap reads as a network failure to the RPC and Telegram clients', async () => {
    const budget = new PassBudget(2, ok);
    expect(await attemptPost('https://x.test/', '{}', { timeoutMs: 50, fetch: budget.fetch })).toBe('network');
    expect(budget.used.fetches).toBe(0);
  });

  it('the error carries its own name (the admin alert and the log show it)', () => {
    expect(new BudgetExhaustedError('x').name).toBe('BudgetExhaustedError');
  });

  it('the Free worst case of the spec fits: load, a chunk with the sends floor and the daily work, then the reserves', () => {
    const load = 3;
    expect(load + COST.chunk + COST.sendFloor + COST.daily + 2).toBeLessThanOrEqual(48);
    expect(COST.urgentRescan).toBe(COST.rescanCall + COST.rescanPost);
  });
});
