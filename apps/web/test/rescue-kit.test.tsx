// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { generateKeyPairSigner, type Address, type Signature } from '@solana/kit';
import { checkRescueKit } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { createTestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { changeStaker } from '@stakeward/core/test/thief';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RescueKitPort, RescueKitStatus } from '@/api/rescue-kits';
import en from '@/i18n/en.json';
import { click, connect, connectAndContinue, renderStakePage, SCENARIO_TIMEOUT, WAIT, type RoleName } from './support/stake-pages.tsx';

// /rescue-kit (D118) end to end on the real stake program: all three keys sign each locked account's rescue in advance
// on its own nonce of the new wallet; the kit is kept, not sent. Later, after the thief moved the staker, the kept
// bytes still land and the stake belongs to the new wallet. /rescue-kit/:account sends it only when the worker allows.

const DAY = 86_400n;
const T = START_UNIX_TIMESTAMP + 30n * DAY;

/** A fake of the worker's kit store: accepts only what core checkRescueKit accepts, as the worker does first. */
function fakeKits() {
  const stored = new Map<Address, Uint8Array>();
  const port: RescueKitPort = {
    async store(transaction) {
      const checked = await checkRescueKit(transaction);
      if (!checked.ok) throw new Error(checked.message);
      stored.set(checked.kit.stakeAccount, transaction);
      return { telegramUrl: `https://t.me/stakeward_test_bot?start=kit-${checked.kit.stakeAccount.slice(0, 8)}` };
    },
    status: () => Promise.reject(new Error('not used')),
  };
  return { port, stored };
}

const heading = (name: string | RegExp) => screen.findByRole('heading', { name }, WAIT);

describe('/rescue-kit', () => {
  it(
    'signs and keeps the rescue of the locked account only; the kept bytes land after the thief moved the staker',
    async () => {
      const testChain = await TestChain.create();
      const [A, K, D, X] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner(), generateKeyPairSigner(), testChain.fundedKey()]);
      testChain.airdrop(D.address, 50_000_000n);
      const locked = await testChain.createStakeAccount({
        staker: A.address,
        withdrawer: A.address,
        lockup: { unixTimestamp: T, epoch: 0n, custodian: K.address },
      });
      await testChain.createStakeAccount({ staker: A.address, withdrawer: A.address });
      const [newWallet, main, second] = await Promise.all([
        createTestWalletPort({ name: 'New Wallet', signers: [D] }),
        createTestWalletPort({ name: 'Main Wallet', signers: [A] }),
        createTestWalletPort({ name: 'Second Wallet', signers: [K] }),
      ]);
      const kits = fakeKits();
      const { user } = renderStakePage(new LiteSvmChain(testChain), `/rescue-kit?address=${A.address}`, [newWallet, main, second], {
        rescueKits: kits.port,
      });

      await heading(en.rescue.stake.heading);
      expect(screen.getByRole('heading', { level: 1, name: en.common.pages.rescueKit })).toBeInTheDocument();
      await click(user, en.rescue.next.newWallet);
      await heading(en.rescue.newWallet.heading);
      await connect(user, 'New wallet', 'New Wallet');
      await user.click(screen.getByRole('checkbox', { name: en.rescue.newWallet.seedCheck }));
      await screen.findByText(/^Balance /, undefined, WAIT);
      await click(user, en.rescue.next.keys);
      await heading(en.rescue.keys.heading);
      // Never by link: /cosign would send the kit at once.
      const mainWhere = screen.getByRole('radiogroup', { name: 'Where does your Main key sign?' });
      expect(mainWhere.querySelector('[value="link"]')).toBeDisabled();
      await click(user, en.rescue.next.move);
      await heading(en.rescueKit.sign.heading);

      // The kit's own nonce account, then the three signatures.
      await click(user, 'Create the link-signing account');
      await click(user, 'Sign in New Wallet as New wallet');
      // The new wallet pays and signs first; the main key and the second key follow in message order (by address).
      const remaining: [RoleName, string][] = [
        ['New wallet', 'New Wallet'],
        ['Main key', 'Main Wallet'],
        ['Second key', 'Second Wallet'],
      ];
      while (remaining.length > 0) {
        const [role, wallet] = await waitFor(() => {
          const asked = remaining.find(
            ([r, w]) =>
              screen.queryByRole('button', { name: `Sign in ${w} as ${r}` }) !== null ||
              screen.queryByText(`Connect your ${r} to sign.`) !== null,
          );
          if (asked === undefined) throw new Error('No signer asked yet');
          return asked;
        }, WAIT);
        const name = `Sign in ${wallet} as ${role}`;
        if (screen.queryByRole('button', { name }) === null) await connectAndContinue(user, role, wallet);
        await click(user, name);
        remaining.splice(remaining.findIndex(([r]) => r === role), 1);
      }

      await heading(en.rescueKit.done.heading);
      expect(document.querySelectorAll('[data-kit="saved"]')).toHaveLength(1);
      // The kit's one-time Telegram link: only the chat that opens it can send the kit.
      expect(screen.getByRole('link', { name: en.rescueKit.done.telegram })).toHaveAttribute(
        'href',
        `https://t.me/stakeward_test_bot?start=kit-${locked.slice(0, 8)}`,
      );
      expect([...kits.stored.keys()]).toEqual([locked]);
      // Nothing moved yet.
      expect(testChain.stakeAccount(locked)).toMatchObject({ staker: A.address, withdrawer: A.address });

      await changeStaker(testChain, { stake: locked, withdrawer: A, newStaker: X });
      const result = await testChain.send(kits.stored.get(locked) ?? new Uint8Array());
      expect(result.ok).toBe(true);
      expect(testChain.stakeAccount(locked)).toMatchObject({
        staker: D.address,
        withdrawer: D.address,
        lockup: { unixTimestamp: T, epoch: 0n, custodian: K.address },
      });
    },
    SCENARIO_TIMEOUT,
  );
});

describe('/rescue-kit/:account', () => {
  const ACCOUNT = 'Stake11111111111111111111111111111111111111' as Address;
  const NEW = 'Vote111111111111111111111111111111111111111' as Address;
  const SIG = '5'.repeat(88) as Signature;

  function port(status: Omit<RescueKitStatus, 'stakeAccount'>): RescueKitPort {
    return {
      store: () => Promise.reject(new Error('not used')),
      status: (stakeAccount) => Promise.resolve({ stakeAccount, ...status }),
    };
  }

  it('a ready kit: the new owner in full, sent from the linked Telegram chat; no button here', async () => {
    const testChain = await TestChain.create();
    const rescueKits = port({ status: 'ready', newWallet: NEW, signature: null, sentAt: null, telegramLinked: true });
    renderStakePage(new LiteSvmChain(testChain), `/rescue-kit/${ACCOUNT}`, [], { rescueKits });

    await screen.findByText(en.rescueKit.now.ready, undefined, WAIT);
    expect(screen.getByText(NEW)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rescue now/ })).not.toBeInTheDocument();
  });

  it('a ready kit with no linked chat says so', async () => {
    const testChain = await TestChain.create();
    renderStakePage(new LiteSvmChain(testChain), `/rescue-kit/${ACCOUNT}`, [], {
      rescueKits: port({ status: 'ready', newWallet: NEW, signature: null, sentAt: null, telegramLinked: false }),
    });
    await screen.findByText(en.rescueKit.now.readyNoTelegram, undefined, WAIT);
  });

  it('a sent kit links its transaction', async () => {
    const testChain = await TestChain.create();
    renderStakePage(new LiteSvmChain(testChain), `/rescue-kit/${ACCOUNT}`, [], {
      rescueKits: port({ status: 'sent', newWallet: NEW, signature: SIG, sentAt: 1, telegramLinked: true }),
    });
    await screen.findByText(en.rescueKit.now.sent, undefined, WAIT);
    expect(screen.getByRole('link', { name: en.rescueKit.now.viewTransaction })).toHaveAttribute('href', expect.stringContaining(SIG));
  });
});
