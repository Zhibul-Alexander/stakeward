// Review (step 3, StandardWalletPort serialisation): requests to one wallet run strictly one after another, and nothing
// can release the queue. When a wallet never answers a request (popup lost, extension reloaded, Ledger unplugged
// mid-prompt), the user presses "Stop waiting" (the UI's way out), but every later connect or sign to that wallet
// queues behind the dead promise and never reaches the wallet: the screen shows "waiting for the wallet" with no
// prompt, until the page is reloaded.
import { blockhash, generateKeyPairSigner, getAddressDecoder } from '@solana/kit';
import { buildTransaction } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { StandardWalletPort } from '@/ports/wallet-standard';
import { FakeStandardWallet } from './support/fake-standard-wallet.ts';

const LIFETIME = {
  kind: 'blockhash',
  blockhash: blockhash('EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N'),
  lastValidBlockHeight: 150n,
} as const;
const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('review: a wallet request that never settles', () => {
  it('does not block every later request to the same wallet', async () => {
    const [main, second] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    const wallet = new FakeStandardWallet({ name: 'Stuck', signers: [main] });
    const port = new StandardWalletPort(wallet, 'solana:devnet');
    await port.connect();
    const bytes = buildTransaction(
      {
        kind: 'protect',
        stakeAccount: getAddressDecoder().decode(new Uint8Array(32).fill(7)),
        mainKey: main.address,
        secondKey: second.address,
        lockUntil: 1_800_000_000n,
      },
      { feePayer: main.address, lifetime: LIFETIME },
    ).bytes;

    // First prompt: the wallet never answers. The page's "Stop waiting" aborts the request (fix round of step 3: the
    // WalletPort takes an AbortSignal; the first version of this test only dropped the promise, which no queue can
    // tell from a prompt the user is still reading).
    wallet.gate = new Promise(() => undefined);
    const stopWaiting = new AbortController();
    const first = port.signTransactions(main.address, [bytes], { signal: stopWaiting.signal }).then(
      () => 'answered',
      (error: unknown) => (error instanceof Error ? error.name : 'rejected'),
    );
    await tick(20);
    expect(wallet.signCalls).toHaveLength(1);
    stopWaiting.abort();
    expect(await first).toBe('AbortError');

    // The user tries again (a new run, or Continue after switching accounts): the wallet must be asked again. Its old
    // prompt is still open here, so it answers busy (WalletBusyError) instead of the site waiting in silence.
    wallet.gate = null;
    const again: unknown = await port.signTransactions(main.address, [bytes]).catch((error: unknown) => error);
    expect(again).toMatchObject({ name: 'WalletBusyError' });
    const connectsBefore = wallet.connectCalls;
    void port.connect().catch(() => undefined);
    await tick(200);
    expect(wallet.connectCalls - connectsBefore).toBe(1);
  });
});
