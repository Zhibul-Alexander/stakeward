import type { Address, Signature } from '@solana/kit';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LinkCard } from './link-card.tsx';
import { qrModules } from './qr-code.tsx';

const MAIN = 'B1agBSrGRgub2jXMJEozYkRLRzFc9HLd5hHjSrCtuXu8' as Address;
const SECOND = '9DpLwZiYboWcwYFVtSjSksfaP9EqVoSuZw7Jofet96fi' as Address;
const TX_ID = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW' as Signature;
const URL_TEXT = 'https://stakeward.example/cosign#tx=AQID';

describe('LinkCard', () => {
  it('names the key to send it to, shows its address in full, the link, the transaction and the wait', async () => {
    const user = userEvent.setup();
    const onStopWaiting = vi.fn();
    render(
      <LinkCard
        url={URL_TEXT}
        signature={TX_ID}
        signers={[{ role: 'second', address: SECOND }]}
        watching
        lastCheckFailed={false}
        onStopWaiting={onStopWaiting}
        cancel={<button type="button">Cancel slot</button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Send this link to your Second key' })).toBeInTheDocument();
    expect(screen.getByText(SECOND)).toBeInTheDocument();
    expect(screen.getByText('The link carries signatures, never a key.')).toBeInTheDocument();
    expect(screen.getByText('Open it on the device with your Second key: scan the code or copy the link.')).toBeInTheDocument();
    // The QR code holds the link itself (same text as the field below it).
    const qr = screen.getByRole('img', { name: 'QR code of the signing link' });
    expect(qr.querySelector('path')?.getAttribute('d')).not.toBe('');
    expect(qr.getAttribute('viewBox')).toBe(`-4 -4 ${String((qrModules(URL_TEXT) ?? 0) + 8)} ${String((qrModules(URL_TEXT) ?? 0) + 8)}`);
    expect(screen.getByLabelText('Signing link')).toHaveValue(URL_TEXT);
    expect(screen.getByRole('link', { name: /on Solana Explorer/ })).toHaveAttribute('href', expect.stringContaining(`/tx/${TX_ID}`));
    // The wait in a word (with a spinner) and how it works; Copy link is the card's one filled button.
    expect(screen.getByText('Waiting for the other device').closest('[role="status"]')).not.toBeNull();
    expect(screen.getByText('This page checks the network every few seconds.')).toBeInTheDocument();
    expect(screen.queryByText('Network unreachable, still trying')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy link' })).toHaveAttribute('data-variant', 'primary');
    // The ways out: Stop waiting (the link keeps working), and Cancel, which opens the page's cancel inside the card.
    expect(screen.getByText(/The link keeps working after you leave/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop waiting here' }));
    expect(onStopWaiting).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Cancel slot' })).not.toBeInTheDocument();
    const cancel = screen.getByRole('button', { name: 'Cancel the link' });
    expect(cancel).toHaveAttribute('aria-expanded', 'false');
    await user.click(cancel);
    expect(cancel).toHaveAttribute('aria-expanded', 'true');
    const slot = screen.getByRole('button', { name: 'Cancel slot' });
    expect(slot.closest('[data-slot="link-card"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument();
  });

  it('several keys by link: one device with both', () => {
    render(
      <LinkCard
        url={URL_TEXT}
        signature={null}
        signers={[
          { role: 'main', address: MAIN },
          { role: 'second', address: SECOND },
        ]}
        watching
        lastCheckFailed
      />,
    );
    expect(
      screen.getByRole('heading', { level: 3, name: 'Send this link to the device with your Main key and Second key' }),
    ).toBeInTheDocument();
    expect(screen.getByText(MAIN)).toBeInTheDocument();
    expect(screen.getByText(SECOND)).toBeInTheDocument();
    expect(screen.queryByText('Transaction')).not.toBeInTheDocument();
    expect(screen.getByText('Open it on the device with your Main key and Second key: scan the code or copy the link.')).toBeInTheDocument();
    expect(screen.getByText('Network unreachable, still trying').closest('[role="status"]')).not.toBeNull();
    // Without the page's callbacks there is nothing to stop or cancel here.
    expect(screen.queryByRole('button', { name: 'Stop waiting here' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel the link' })).not.toBeInTheDocument();
  });

  it('paused: says the link still works and offers Check again', async () => {
    const user = userEvent.setup();
    const onCheckAgain = vi.fn();
    render(
      <LinkCard
        url={URL_TEXT}
        signature={TX_ID}
        signers={[{ role: 'second', address: SECOND }]}
        watching={false}
        lastCheckFailed
        onCheckAgain={onCheckAgain}
      />,
    );
    expect(screen.getByText('Stopped checking').closest('[role="status"]')).not.toBeNull();
    expect(screen.getByText('Stopped checking after 30 minutes. The link still works.')).toBeInTheDocument();
    expect(screen.queryByText(/Waiting for the other device/)).not.toBeInTheDocument();
    expect(screen.queryByText('Network unreachable, still trying')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(onCheckAgain).toHaveBeenCalledTimes(1);
  });

  it('Copy link copies the link and says so; a refused clipboard says to copy by hand', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <LinkCard url={URL_TEXT} signature={TX_ID} signers={[{ role: 'second', address: SECOND }]} watching lastCheckFailed={false} />,
    );
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await navigator.clipboard.readText()).toBe(URL_TEXT);
    expect(screen.getByText('Link copied')).toBeInTheDocument();
    unmount();

    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('NotAllowedError'));
    render(<LinkCard url={URL_TEXT} signature={TX_ID} signers={[{ role: 'second', address: SECOND }]} watching lastCheckFailed={false} />);
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(screen.getByText('Could not copy. Select the link and copy it by hand.')).toBeInTheDocument();
  });
});
