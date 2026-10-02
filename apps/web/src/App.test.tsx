import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App, SOURCE_CODE_URL } from '@/App.tsx';

describe('placeholder page', () => {
  it('shows the name, the coming-soon note and the footer', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Stakeward' })).toBeInTheDocument();
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Source code' })).toHaveAttribute('href', SOURCE_CODE_URL);
    expect(screen.getByText('No warranty. MIT license.')).toBeInTheDocument();
  });
});
