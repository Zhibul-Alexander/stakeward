import { generateKeyPairSigner } from '@solana/kit';
import { createTestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { describe, expect, it, vi } from 'vitest';
import { connectOffering } from './connect-offering.ts';

describe('connectOffering', () => {
  it('a wallet that offers a fitting account at once is not disconnected', async () => {
    const [a, k] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    const wallet = await createTestWalletPort({ signers: [a, k] });
    const disconnect = vi.spyOn(wallet, 'disconnect');
    expect(await connectOffering(wallet, (offered) => offered.includes(k.address))).toEqual([a.address, k.address]);
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('Phantom stays on the account it connected first: one disconnect, then the selected account', async () => {
    const [a, k] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    const phantom = await createTestWalletPort({ name: 'Phantom', signers: [a, k], sticky: true });
    expect(await phantom.connect()).toEqual([a.address]);
    phantom.select(k.address);
    // Phantom itself answers with the old account again.
    expect(await phantom.connect()).toEqual([a.address]);
    const disconnect = vi.spyOn(phantom, 'disconnect');
    expect(await connectOffering(phantom, (offered) => offered.includes(k.address))).toEqual([k.address]);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(phantom.accounts).toEqual([k.address]);
  });

  it('the user did not switch: the answer after one reconnect comes back as it is, the caller decides', async () => {
    const [a, k] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    const phantom = await createTestWalletPort({ name: 'Phantom', signers: [a, k], sticky: true, connected: true });
    const connect = vi.spyOn(phantom, 'connect');
    expect(await connectOffering(phantom, (offered) => offered.includes(k.address))).toEqual([a.address]);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('a declined connect rejects; an aborted request is not asked again', async () => {
    const [a, k] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    const declining = await createTestWalletPort({ signers: [a] });
    declining.rejectConnect = true;
    await expect(connectOffering(declining, () => true)).rejects.toMatchObject({ code: 4001 });

    const phantom = await createTestWalletPort({ name: 'Phantom', signers: [a, k], sticky: true, connected: true });
    const controller = new AbortController();
    const connect = vi.spyOn(phantom, 'connect').mockImplementation(() => {
      controller.abort();
      return Promise.resolve([a.address]);
    });
    expect(await connectOffering(phantom, (offered) => offered.includes(k.address), { signal: controller.signal })).toEqual([a.address]);
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
