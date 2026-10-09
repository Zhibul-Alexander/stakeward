import { getAddressDecoder, type Address } from '@solana/kit';
import { MAX_WATCH_ACCOUNTS, type WatchRejectReason, type WatchResult } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { createApiPort, postWatch, WatchHttpError, watchWithRetry, type ApiPort } from './watch.ts';

const key = (n: number): Address => {
  const bytes = new Uint8Array(32);
  new DataView(bytes.buffer).setUint32(0, n + 1);
  return getAddressDecoder().decode(bytes);
};
const [A, B, C] = [key(1), key(2), key(3)];

type Call = { url: string; method: string | undefined; headers: Record<string, string>; accounts: string[] };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A worker that watches every account it is asked, recording each request; `answer` overrides the reply. */
function worker(answer?: (accounts: string[], index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  let open = 0;
  let maxOpen = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (typeof init?.body !== 'string') throw new Error('expected a JSON string body');
    const body = JSON.parse(init.body) as { accounts: string[] };
    calls.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      method: init.method,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      accounts: body.accounts,
    });
    open += 1;
    maxOpen = Math.max(maxOpen, open);
    await Promise.resolve();
    try {
      return await (answer?.(body.accounts, calls.length - 1) ??
        json(200, { slot: '42', results: body.accounts.map((account) => ({ account, status: 'watched' })) }));
    } finally {
      open -= 1;
    }
  };
  return { fetch, calls, maxOpen: () => maxOpen };
}

describe('postWatch', () => {
  it('POSTs { accounts } as JSON to /api/watch on this origin and returns the results in order', async () => {
    const { fetch, calls } = worker((accounts) =>
      json(200, {
        slot: '42',
        results: [
          { account: accounts[0], status: 'watched' },
          { account: accounts[1], status: 'already-watched' },
          { account: accounts[2], status: 'rejected', reason: 'not-locked' },
        ],
      }),
    );
    expect(await postWatch([A, B, C], { fetch })).toEqual([
      { account: A, status: 'watched', reason: null },
      { account: B, status: 'already-watched', reason: null },
      { account: C, status: 'rejected', reason: 'not-locked' },
    ]);
    expect(calls).toEqual([
      { url: '/api/watch', method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, accounts: [A, B, C] },
    ]);
  });

  it(`asks once per account, in chunks of ${String(MAX_WATCH_ACCOUNTS)} sent one after another`, async () => {
    const accounts = Array.from({ length: 45 }, (_, n) => key(n));
    const { fetch, calls, maxOpen } = worker();
    const results = await postWatch([...accounts, accounts[3] ?? A, accounts[30] ?? A], { fetch });
    expect(calls.map((call) => call.accounts.length)).toEqual([20, 20, 5]);
    expect(calls.flatMap((call) => call.accounts)).toEqual(accounts);
    expect(results.map((result) => result.account)).toEqual(accounts);
    expect(maxOpen()).toBe(1);
  });

  it('sends nothing for an empty list', async () => {
    const { fetch, calls } = worker();
    expect(await postWatch([], { fetch })).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('reads the answer strictly: order, length, keys and statuses must match the request', async () => {
    const strict = async (body: unknown) => {
      const { fetch } = worker(() => json(200, body));
      return postWatch([A, B], { fetch });
    };
    const watched = (account: Address) => ({ account, status: 'watched' });
    await expect(strict({ slot: '1', results: [watched(B), watched(A)] })).rejects.toMatchObject({ name: 'InvalidWatchResponseError' });
    await expect(strict({ slot: '1', results: [watched(A)] })).rejects.toMatchObject({ name: 'InvalidWatchResponseError' });
    await expect(strict({ slot: '1', results: [watched(A), watched(B)], extra: true })).rejects.toMatchObject({
      name: 'InvalidWatchResponseError',
    });
    await expect(strict({ slot: '1', results: [watched(A), { account: B, status: 'maybe' }] })).rejects.toMatchObject({
      name: 'InvalidWatchResponseError',
    });
    await expect(strict({ slot: '1', results: [{ ...watched(A), reason: 'not-locked' }, watched(B)] })).rejects.toMatchObject({
      name: 'InvalidWatchResponseError',
    });
    await expect(strict({ slot: 1, results: [watched(A), watched(B)] })).rejects.toMatchObject({ name: 'InvalidWatchResponseError' });
  });

  it("turns another status into a WatchHttpError with the worker's error code", async () => {
    const limited = worker(() => json(429, { error: 'rate-limited', message: 'Too many requests, try again in a minute' }));
    const error: unknown = await postWatch([A], { fetch: limited.fetch }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WatchHttpError);
    expect(error).toMatchObject({ name: 'WatchHttpError', status: 429, code: 'rate-limited' });

    const gateway = worker(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(postWatch([A], { fetch: gateway.fetch })).rejects.toMatchObject({ status: 502, code: 'http-502' });
  });

  it('gives up after the timeout (every wait is finite)', async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    await expect(postWatch([A], { fetch: hanging, timeoutMs: 10 })).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('createApiPort watches through the given fetch', async () => {
    const { fetch, calls } = worker();
    expect(await createApiPort({ fetch }).watch([A])).toEqual([{ account: A, status: 'watched', reason: null }]);
    expect(calls).toHaveLength(1);
  });
});

type Reply = Error | Partial<Record<Address, 'watched' | 'already-watched' | WatchRejectReason>>;

/** An ApiPort that answers each call from a script (one entry per call; an account not named is watched). */
function scriptedApi(replies: readonly Reply[]) {
  const calls: Address[][] = [];
  const api: ApiPort = {
    watch: (accounts) => {
      const reply = replies[calls.length] ?? {};
      calls.push([...accounts]);
      if (reply instanceof Error) return Promise.reject(reply);
      return Promise.resolve(
        accounts.map((account): WatchResult => {
          const answer = reply[account] ?? 'watched';
          return answer === 'watched' || answer === 'already-watched'
            ? { account, status: answer, reason: null }
            : { account, status: 'rejected', reason: answer };
        }),
      );
    },
  };
  return { api, calls };
}

describe('watchWithRetry', () => {
  const noWait = () => {
    const slept: number[] = [];
    return { slept, sleep: (ms: number) => (slept.push(ms), Promise.resolve()) };
  };

  it('is on when every account is watched (already watched counts)', async () => {
    const { api, calls } = scriptedApi([{ [B]: 'already-watched' }]);
    expect(await watchWithRetry(api, [A, B], noWait())).toEqual({ kind: 'on' });
    expect(calls).toEqual([[A, B]]);
  });

  it('asks again, 2 s later, only for the accounts the node did not show locked yet', async () => {
    const { api, calls } = scriptedApi([{ [B]: 'not-locked' }, {}]);
    const time = noWait();
    expect(await watchWithRetry(api, [A, B], time)).toEqual({ kind: 'on' });
    expect(calls).toEqual([[A, B], [B]]);
    expect(time.slept).toEqual([2_000]);
  });

  it('stops after 3 calls: partial when some are watched, failed when none is', async () => {
    const lagging = scriptedApi([{ [B]: 'not-locked' }, { [B]: 'not-locked' }, { [B]: 'not-locked' }, {}]);
    expect(await watchWithRetry(lagging.api, [A, B], noWait())).toEqual({ kind: 'partial', rejected: [{ account: B, reason: 'not-locked' }] });
    expect(lagging.calls).toHaveLength(3);

    const none = scriptedApi([{ [A]: 'not-locked' }, { [A]: 'not-locked' }, { [A]: 'not-locked' }]);
    const state = await watchWithRetry(none.api, [A], noWait());
    expect(state).toMatchObject({ kind: 'failed' });
    expect(state.kind === 'failed' ? state.detail : '').toContain(`${A}: not-locked`);
  });

  it('does not retry a rejection the chain will not change', async () => {
    const { api, calls } = scriptedApi([{ [B]: 'unsupported-lock', [C]: 'not-found' }]);
    expect(await watchWithRetry(api, [A, B, C], noWait())).toEqual({
      kind: 'partial',
      rejected: [
        { account: B, reason: 'unsupported-lock' },
        { account: C, reason: 'not-found' },
      ],
    });
    expect(calls).toHaveLength(1);
  });

  it('retries whole calls after a network error, a timeout, a malformed body or HTTP 5xx', async () => {
    const timeout = Object.assign(new Error('No answer within 8 s'), { name: 'TimeoutError' });
    const malformed = Object.assign(new Error('Invalid watch response: body is not an object'), { name: 'InvalidWatchResponseError' });
    for (const failure of [new TypeError('Failed to fetch'), timeout, malformed, new WatchHttpError(502, 'upstream-error'), new WatchHttpError(500, 'http-500')]) {
      const { api, calls } = scriptedApi([failure, {}]);
      expect(await watchWithRetry(api, [A, B], noWait()), failure.name).toEqual({ kind: 'on' });
      expect(calls).toEqual([[A, B], [A, B]]);
    }
  });

  it('does not retry 400, 413, 415 or 429', async () => {
    for (const [status, code] of [[400, 'invalid-body'], [413, 'too-large'], [415, 'unsupported-media-type'], [429, 'rate-limited']] as const) {
      const { api, calls } = scriptedApi([new WatchHttpError(status, code), {}]);
      const state = await watchWithRetry(api, [A], noWait());
      expect(state, code).toMatchObject({ kind: 'failed' });
      expect(state.kind === 'failed' ? state.detail : '').toContain(code);
      expect(calls).toHaveLength(1);
    }
  });

  it('a later failure keeps what earlier calls watched', async () => {
    const offline = new TypeError('Failed to fetch');
    const { api, calls } = scriptedApi([{ [B]: 'not-locked' }, offline, offline]);
    expect(await watchWithRetry(api, [A, B], noWait())).toEqual({ kind: 'partial', rejected: [{ account: B, reason: 'not-locked' }] });
    expect(calls).toHaveLength(3);
  });

  it('fails with the last error when no call got through', async () => {
    const offline = new TypeError('Failed to fetch');
    const { api, calls } = scriptedApi([offline, offline, offline, {}]);
    const state = await watchWithRetry(api, [A], { ...noWait(), attempts: 3 });
    expect(state).toEqual({ kind: 'failed', detail: expect.stringContaining('Failed to fetch') as unknown });
    expect(calls).toHaveLength(3);
  });

  it('honours attempts and asks nothing for an empty list', async () => {
    const once = scriptedApi([{ [A]: 'not-locked' }, {}]);
    expect(await watchWithRetry(once.api, [A], { ...noWait(), attempts: 1 })).toMatchObject({ kind: 'failed' });
    expect(once.calls).toHaveLength(1);

    const empty = scriptedApi([]);
    expect(await watchWithRetry(empty.api, [], noWait())).toEqual({ kind: 'idle' });
    expect(empty.calls).toEqual([]);
  });
});
