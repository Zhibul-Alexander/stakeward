// Playwright fixtures of the QA suite: the chain (Node side), headless wallets, page-error collection.
import { test as base, expect, type Page } from '@playwright/test';
import type { Address, KeyPairSigner } from '@solana/kit';
import { QaChain } from './chain.ts';
import { QA } from './env.ts';
import { installWallets, QaWallet } from './wallet.ts';

type Wallets = {
  /** A new funded test key in a new wallet named `name`, registered in this test's pages. Call before page.goto. */
  create(name: string, sol?: number): Promise<QaWallet>;
  /** A wallet over an existing key (e.g. to show the same key under a second wallet name). */
  wrap(name: string, signer: KeyPairSigner): Promise<QaWallet>;
};

type Fixtures = {
  qa: QaChain;
  wallets: Wallets;
  /** Uncaught page errors and CSP violations seen so far; the test fails at the end if there are any. */
  pageErrors: string[];
};

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern
  qa: async ({}, use) => {
    const chain = new QaChain();
    // dev runs against the real per-IP rate limits (POST /api/rpc 30 per 10 s, lookups 20 per minute): pause between
    // scenarios so one scenario's 429s are not caused by the one before it.
    if (QA.target === 'dev') await new Promise((resolve) => setTimeout(resolve, QA.cooldownMs));
    await use(chain);
    await chain.sweep();
  },
  wallets: async ({ context, qa }, use) => {
    await use({
      async create(name, sol = 0.1) {
        const wallet = new QaWallet(name, await qa.newKey(sol));
        await installWallets(context, [wallet]);
        return wallet;
      },
      async wrap(name, signer) {
        const wallet = new QaWallet(name, signer);
        await installWallets(context, [wallet]);
        return wallet;
      },
    });
  },
  pageErrors: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = [];
      const consoleLines: string[] = [];
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
      const api = new Map<string, number>();
      page.on('response', (response) => {
        const url = new URL(response.url());
        if (!url.pathname.startsWith('/api/')) return;
        const key = `${url.pathname} ${String(response.status())}`;
        api.set(key, (api.get(key) ?? 0) + 1);
      });
      page.on('console', (message) => {
        if (message.type() !== 'error' && message.type() !== 'warning') return;
        const text = message.text();
        consoleLines.push(`${message.type()}: ${text}`);
        // A CSP violation is a product bug on any target (CLAUDE.md section 11).
        if (/Content Security Policy|Refused to (?:apply|load|execute|connect)/i.test(text)) errors.push(`csp: ${text}`);
      });
      await use(errors);
      const usage = [...api].sort().map(([key, count]) => `${key}: ${String(count)}`);
      if (usage.length > 0) await testInfo.attach('api-usage', { body: usage.join('\n'), contentType: 'text/plain' });
      if (consoleLines.length > 0) {
        await testInfo.attach('console', { body: consoleLines.join('\n'), contentType: 'text/plain' });
      }
      expect(errors, 'uncaught page errors and CSP violations').toEqual([]);
    },
    { auto: true },
  ],
});

/** Skips the test unless the target can run it (local-only controls, delegated stake on dev). */
export function requires(feature: 'local-controls' | 'delegated'): void {
  if (feature === 'local-controls') test.skip(QA.target !== 'local', 'needs the local chain controls');
  if (feature === 'delegated') test.skip(QA.target === 'dev' && !QA.delegatedOnDev, 'delegated stake on dev needs QA_DELEGATED=1 (1 SOL each)');
}

export { expect };

// ---- UI steps shared by the scenarios ----

export type Role = 'Main key' | 'Second key' | 'New wallet';

/** Connects `walletName` in the slot of `role` (the slot shows a list of detected wallets). */
export async function connect(page: Page, role: Role, walletName: string): Promise<void> {
  const slot = page.getByRole('group', { name: role });
  await slot.getByRole('button', { name: `Connect a wallet as ${role}` }).click();
  await slot.getByRole('button', { name: walletName, exact: true }).click();
  await expect(page.getByRole('group', { name: role })).toHaveAttribute('data-status', 'connected');
}

/** Presses the Sign button for `wallet` as `role` ("Sign in X as R" or "Sign 2 transactions in X as R"). */
export async function sign(page: Page, wallet: QaWallet, role: Role): Promise<void> {
  await signButton(page, wallet, role).click();
}

function signButton(page: Page, wallet: QaWallet, role: Role) {
  return page.getByRole('button', { name: new RegExp(`^Sign (?:\\d+ transactions )?in ${escape(wallet.name)} as ${role}$`) });
}

/**
 * Signs as each of `signers` in whatever order the page asks, connecting a key the first time the page asks for it
 * ("Connect your Main key to sign." -> its slot -> Use this wallet). Order-agnostic, like a person following the page.
 */
export async function signAll(page: Page, signers: readonly { wallet: QaWallet; role: Role }[]): Promise<void> {
  const remaining = [...signers];
  while (remaining.length > 0) {
    let next: { index: number; connect: boolean } | null = null;
    await expect(async () => {
      for (const [index, signer] of remaining.entries()) {
        if (await signButton(page, signer.wallet, signer.role).isVisible()) next = { index, connect: false };
        else if (await page.getByText(`Connect your ${signer.role} to sign.`).isVisible()) next = { index, connect: true };
        if (next !== null) return;
      }
      throw new Error(`none of ${remaining.map((signer) => signer.role).join(', ')} is asked to sign yet`);
    }).toPass();
    const { index, connect: mustConnect } = next as unknown as { index: number; connect: boolean };
    const signer = remaining[index] as { wallet: QaWallet; role: Role };
    if (mustConnect) {
      await connect(page, signer.role, signer.wallet.name);
      await page.getByRole('button', { name: 'Use this wallet' }).click();
    }
    await signButton(page, signer.wallet, signer.role).click();
    remaining.splice(index, 1);
  }
}

export function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The lock a stake account holds now, read from the chain. */
export async function lockOf(qa: QaChain, stake: Address) {
  const account = await qa.stake(stake);
  if (account === null) throw new Error(`${stake} is closed`);
  return account.lockup;
}
