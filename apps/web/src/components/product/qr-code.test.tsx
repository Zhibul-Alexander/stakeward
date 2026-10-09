import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QrCode, qrModules } from './qr-code.tsx';

const LINK = 'https://stakeward-prod.example-domain.com/cosign#tx=AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHw';

describe('QrCode', () => {
  it('draws the code as one path in an svg image named by its label, with the quiet zone in the view box', () => {
    render(<QrCode value={LINK} label="QR code of the signing link" />);
    const svg = screen.getByRole('img', { name: 'QR code of the signing link' });
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg).toHaveAttribute('data-slot', 'qr-code');
    const size = qrModules(LINK);
    expect(size).not.toBeNull();
    expect(svg).toHaveAttribute('viewBox', `-4 -4 ${String((size ?? 0) + 8)} ${String((size ?? 0) + 8)}`);
    const paths = svg.querySelectorAll('path');
    expect(paths).toHaveLength(1);
    expect(paths[0]?.getAttribute('d')).toMatch(/^M\d/);
    expect(paths[0]).toHaveClass('fill-qr-dark');
    expect(svg.querySelector('rect')).toHaveClass('fill-qr-light');
  });

  it('works under the strict CSP: no style attribute, no <style> element, no data: URI', () => {
    const { container } = render(<QrCode value={LINK} label="QR code" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.hasAttribute('style')).toBe(false);
    expect(svg?.querySelectorAll('[style]')).toHaveLength(0);
    expect(svg?.querySelectorAll('style')).toHaveLength(0);
    expect(container.innerHTML).not.toContain('data:');
  });

  it('a text too long for any QR code says to copy it instead, with no image', () => {
    render(<QrCode value={'x'.repeat(3000)} label="QR code" />);
    expect(screen.getByText('This link is too long for a QR code. Copy it instead.')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});

describe('qrModules', () => {
  it('grows with the text: 21 modules for version 1, null past version 40', () => {
    expect(qrModules('a')).toBe(21);
    const long = qrModules('x'.repeat(1_000));
    expect(long).not.toBeNull();
    expect(((long ?? 0) - 17) % 4).toBe(0);
    expect(qrModules('x'.repeat(3000))).toBeNull();
  });
});
