import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FlowsSection } from './FlowsSection.tsx';
import { SAMPLE } from './samples.ts';

// /dev/ui shows the signing panel in each phase and the protect Done screen (step 4 spec section 7, DW7). The page is
// large, so the checks use selectors and text rather than role queries over the whole tree.
describe('/dev/ui flows', () => {
  it('renders the signing panel in every phase and the Done screen in three outcomes', async () => {
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

    const titles = [...document.querySelectorAll('#protect-result [data-slot="protect-done"] > h2')].map((heading) => heading.textContent);
    expect(titles).toEqual(['2 stake accounts are protected', '1 of 4 stake accounts are protected', 'No stake account was protected']);
    expect(document.querySelectorAll(`#protect-result a[href="/api/telegram/link?wallet=${SAMPLE.mainKey}"]`)).toHaveLength(3);
  }, 30_000);
});
