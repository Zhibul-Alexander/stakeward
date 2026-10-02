import { describe, expect, it } from 'vitest';
import { createWalletRequestQueue } from './wallet-queue.ts';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const never = () => new Promise<never>(() => undefined);

describe('createWalletRequestQueue', () => {
  it('runs requests one after another', async () => {
    const queue = createWalletRequestQueue();
    const started: string[] = [];
    let finishFirst: () => void = () => undefined;
    const first = queue(() => {
      started.push('first');
      return new Promise<string>((resolve) => {
        finishFirst = () => {
          resolve('first done');
        };
      });
    });
    const second = queue(() => {
      started.push('second');
      return Promise.resolve('second done');
    });
    await tick();
    expect(started).toEqual(['first']);
    finishFirst();
    await expect(Promise.all([first, second])).resolves.toEqual(['first done', 'second done']);
    expect(started).toEqual(['first', 'second']);
  });

  it('a failed request does not stop the next one', async () => {
    const queue = createWalletRequestQueue();
    await expect(queue(() => Promise.reject(new Error('declined')))).rejects.toThrow('declined');
    await expect(queue(() => Promise.resolve(1))).resolves.toBe(1);
  });

  it('a request the wallet never answers holds the queue until its caller stops waiting', async () => {
    const queue = createWalletRequestQueue();
    const controller = new AbortController();
    const stuck = queue(never, controller.signal);
    let asked = false;
    const next = queue(() => {
      asked = true;
      return Promise.resolve('asked');
    });
    await tick();
    expect(asked).toBe(false);
    controller.abort(new Error('Stopped waiting'));
    await expect(stuck).rejects.toThrow('Stopped waiting');
    await expect(next).resolves.toBe('asked');
  });

  it('a request abandoned while it waits for its turn never reaches the wallet', async () => {
    const queue = createWalletRequestQueue();
    let finishFirst: () => void = () => undefined;
    const first = queue(() => new Promise<void>((resolve) => (finishFirst = resolve)));
    const controller = new AbortController();
    let asked = false;
    const abandoned = queue(() => {
      asked = true;
      return Promise.resolve();
    }, controller.signal);
    controller.abort();
    await expect(abandoned).rejects.toMatchObject({ name: 'AbortError' });
    // The one still wanted keeps its place: a later request waits for it.
    let third = false;
    const later = queue(() => {
      third = true;
      return Promise.resolve();
    });
    await tick();
    expect(third).toBe(false);
    finishFirst();
    await first;
    await later;
    expect(third).toBe(true);
    expect(asked).toBe(false);
  });

  it('an already aborted signal rejects at once', async () => {
    const queue = createWalletRequestQueue();
    await expect(queue(() => Promise.resolve(1), AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
  });
});
