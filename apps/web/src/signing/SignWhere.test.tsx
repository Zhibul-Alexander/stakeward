import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SignWhere, type SignMode } from './SignWhere.tsx';

function Controlled({ initial, onChange, disabledLink }: { initial: SignMode; onChange: (mode: SignMode) => void; disabledLink?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <SignWhere
      role="second"
      value={value}
      onChange={(mode) => {
        setValue(mode);
        onChange(mode);
      }}
      disabledLink={disabledLink}
    />
  );
}

describe('SignWhere', () => {
  it('asks where the key signs, both ways explained; choosing by link reports it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial="here" onChange={onChange} />);
    const group = screen.getByRole('radiogroup', { name: 'Where does your Second key sign?' });
    expect(group).toBeInTheDocument();
    const here = screen.getByRole('radio', { name: 'In this browser' });
    const link = screen.getByRole('radio', { name: 'On another device, by link' });
    expect(here).toBeChecked();
    expect(here).toHaveAccessibleDescription("Connect it here and approve here. A phone wallet's browser holds only that wallet.");
    expect(link).toHaveAccessibleDescription('Get a link and QR code for the other device. Needs a small deposit that comes back.');
    // Two cards side by side from 640 px; the radios stay visible inside them.
    expect(document.querySelectorAll('[data-slot="sign-where"] [data-slot="radio-card"]')).toHaveLength(2);
    await user.click(link);
    expect(onChange).toHaveBeenLastCalledWith('link');
    expect(link).toBeChecked();
    await user.click(here);
    expect(onChange).toHaveBeenLastCalledWith('here');
  });

  it('a disabled link option says why, and cannot be chosen', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial="here" onChange={onChange} disabledLink="Without a lock, connect that wallet in this browser." />);
    const link = screen.getByRole('radio', { name: 'On another device, by link' });
    expect(link).toBeDisabled();
    expect(link).toHaveAccessibleDescription(/Needs a small deposit that comes back\. Without a lock, connect that wallet in this browser\./);
    await user.click(link);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: 'In this browser' })).toBeChecked();
  });
});
