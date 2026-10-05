import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { App } from './App.tsx';

function renderAt(path: string) {
  const { hook, searchHook } = memoryLocation({ path, static: true });
  return render(
    <Router hook={hook} searchHook={searchHook}>
      <App />
    </Router>,
  );
}

describe('app shell', () => {
  it.each([
    ['/', 'Protect your staked SOL'],
    ['/app', 'Your stake accounts'],
    ['/protect', 'Protect your stake'],
    ['/withdraw/Stake11111111111111111111111111111111111111', 'Withdraw'],
    ['/extend/Stake11111111111111111111111111111111111111', 'Extend the lock'],
    ['/rescue', 'Rescue your stake'],
    ['/cosign', 'Co-sign a transaction'],
    ['/recovery/Stake11111111111111111111111111111111111111', 'Recovery card'],
    ['/stats', 'Stats'],
    ['/no-such-page', 'Page not found'],
  ])('%s shows its heading inside the layout', (path, heading) => {
    renderAt(path);
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Stakeward home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Your accounts' })).toHaveAttribute('href', '/app');
  });

  it('has the trust links in the footer on every page (UX rule 12)', () => {
    renderAt('/rescue');
    const footer = screen.getByRole('contentinfo');
    expect(footer).toContainElement(screen.getByRole('link', { name: 'Source code' }));
    expect(screen.getByRole('link', { name: 'Source code' })).toHaveAttribute(
      'href',
      'https://github.com/Zhibul-Alexander/stakeward',
    );
    expect(screen.getByRole('link', { name: 'What Stakeward cannot do' })).toHaveAttribute('href', '/#cannot-do');
    expect(screen.getByText('No warranty. MIT license.')).toBeInTheDocument();
  });

  it('placeholder pages offer a way back', () => {
    renderAt('/stats');
    expect(screen.getByRole('link', { name: 'Back to your accounts' })).toHaveAttribute('href', '/app');
  });

  it('loads the devnet-only pages lazily on devnet (the default outside `vite build`)', async () => {
    renderAt('/dev/ui');
    // The lazy chunk is the whole /dev/ui page: transforming it can take several seconds on a loaded machine.
    expect(await screen.findByRole('heading', { level: 1, name: 'Design system' }, { timeout: 20_000 })).toBeInTheDocument();
  }, 30_000);

  it('marks devnet in the header', () => {
    renderAt('/');
    expect(screen.getByText('Devnet')).toBeInTheDocument();
  });
});
