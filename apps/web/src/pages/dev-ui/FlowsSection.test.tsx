import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import { FlowsSection } from './FlowsSection.tsx';
import { SAMPLE } from './samples.ts';

// /dev/ui shows the signing panel in each phase, the protect Done screen (step 4 spec section 7, DW7) and the recovery
// card (step 8 spec 4.7). The page is
// large, so the checks use selectors and text rather than role queries over the whole tree.
describe('/dev/ui flows', () => {
  it('renders the signing panel in every phase, signing by link, the Done screen in three outcomes and the recovery card', async () => {
    render(<FlowsSection />);
    const panels = () => [...document.querySelectorAll('#signing [data-slot="signing-panel"]')];
    await waitFor(
      () => {
        expect(panels()).toHaveLength(14);
      },
      { timeout: 10_000 },
    );
    expect(panels().map((panel) => panel.getAttribute('data-phase'))).toEqual([
      'idle',
      'ready',
      'ready',
      'needs-wallet',
      'switch-account',
      'starting',
      'signing',
      'stopped',
      'stopped',
      'stopped',
      'expired',
      'sending',
      'confirming',
      'prepare-failed',
    ]);
    expect(document.querySelectorAll('#signing [data-slot="transaction-summary"][data-kind="protect"]').length).toBeGreaterThan(0);
    expect(screen.getByText('Sign 2 transactions in Sample Wallet as Main key')).toBeInTheDocument();
    expect(
      screen.getByText('Sample Wallet holds more than one of your keys. Switch Sample Wallet to the account of your Second key, then sign.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Start again with Demo Wallet signing first')).toBeInTheDocument();
    expect(screen.getByText('Checking the network before asking Sample Wallet')).toBeInTheDocument();
    expect(screen.getByText('This round was not sent')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop here and see the result' })).toBeInTheDocument();

    // Signing by link: the first device with the link open, then paused; the device that opened the link, gated by
    // its confirmation box.
    const linkPanels = () => [...document.querySelectorAll('#link [data-slot="signing-panel"]')];
    await waitFor(() => {
      expect(linkPanels()).toHaveLength(3);
    });
    expect(linkPanels().map((panel) => panel.getAttribute('data-phase'))).toEqual(['link', 'link', 'ready']);
    expect(document.querySelectorAll('#link [data-slot="transaction-summary"][data-kind="rescue"]')).toHaveLength(3);
    const qrPaths = [...document.querySelectorAll('#link [data-slot="link-card"] svg[data-slot="qr-code"] path')];
    expect(qrPaths).toHaveLength(2);
    for (const path of qrPaths) expect(path.getAttribute('d')).toMatch(/^M\d/);
    expect(screen.getByText('Stopped checking after 30 minutes. The link still works.')).toBeInTheDocument();
    const [watching] = linkPanels();
    expect(
      [...(watching?.querySelectorAll('[data-slot="signer-list"] li') ?? [])].map((item) => item.getAttribute('data-status')),
    ).toEqual(['signed', 'signed', 'link']);
    expect(screen.getByLabelText('I checked this new wallet address with the owner by voice or in person, or it is mine')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Sign in Sample Wallet as Second key' })).toHaveAttribute('aria-disabled', 'true');
    // The link card's cancel slot, then the link-signing account's cards: set up (by link, for a rescue), close, cancel,
    // refused, gate blocked.
    await waitFor(() => {
      expect(document.querySelectorAll('#link > div:last-child > figure')).toHaveLength(6);
    });
    const cards = [...document.querySelectorAll('#link [data-slot="nonce-step"]')];
    expect(cards.map((card) => `${card.getAttribute('data-mode') ?? ''}/${card.getAttribute('data-variant') ?? ''}`)).toEqual([
      'close/cancel-link',
      'close/cancel-link',
      'setup/close',
      'setup/rescue',
      'close/close',
      'close/cancel-link',
      'setup/close',
    ]);
    expect(screen.getAllByRole('button', { name: 'Cancel the link' })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'Create the link-signing account' })).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Set up the link-signing account' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close it' })).toBeInTheDocument();
    expect(screen.getAllByText(/already taken by another account/)).toHaveLength(2);
    expect(document.querySelectorAll('#link [data-slot="nonce-blocked"]')).toHaveLength(1);

    const titles = [...document.querySelectorAll('#protect-result [data-slot="protect-done"] > h2')].map((heading) => heading.textContent);
    expect(titles).toEqual(['2 stake accounts are protected', '1 of 4 stake accounts are protected', 'No stake account was protected']);
    expect(document.querySelectorAll(`#protect-result a[href="/api/telegram/link?wallet=${SAMPLE.mainKey}"]`)).toHaveLength(3);

    // The recovery card of the sample keys (spec 4.7): two accounts, one managed by another key; the first lock ends
    // within 30 days, so the card names its time; one more account of the main key is not on the card.
    expect(document.querySelectorAll('#recovery [data-slot="recovery-card"]')).toHaveLength(1);
    expect(document.querySelectorAll('#recovery [data-slot="recovery-account"]')).toHaveLength(2);
    expect(document.querySelectorAll('#recovery [data-slot="managed-by"]')).toHaveLength(1);
    expect(document.querySelector('#recovery [data-risk="lock-ends"]')).toHaveTextContent(/, 14:30 UTC the lock ends/);
    expect(screen.getByText(/^This main key has 1 more stake account that this card does not cover/)).toBeInTheDocument();

    // The landing's wallet table as a matrix run would fill it (spec 4.7): every verdict and every note at least once.
    const wallets = document.getElementById('landing-wallets') as HTMLElement;
    expect(wallets.querySelectorAll('[data-pair]')).toHaveLength(7);
    expect(new Set([...wallets.querySelectorAll('[data-verdict]')].map((badge) => badge.getAttribute('data-verdict')))).toEqual(
      new Set(['not-verified', 'works', 'works-with-warning', 'blind-signing', 'does-not-work']),
    );
    expect(wallets).toHaveTextContent('Tested on Solana devnet on 6 October 2026.');
    for (const note of Object.values(en.landing.wallets.notes)) expect(wallets).toHaveTextContent(note);
  }, 30_000);
});
