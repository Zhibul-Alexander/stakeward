import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AddressField, addressInputError, parseAddressInput } from './AddressField.tsx';

const ADDRESS = '9DpLwZiYboWcwYFVtSjSksfaP9EqVoSuZw7Jofet96fi';

describe('parseAddressInput', () => {
  it('accepts a Solana address, trimmed', () => {
    expect(parseAddressInput(`  ${ADDRESS}\n`)).toEqual({ ok: true, address: ADDRESS });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['not an address', 'invalid'],
    [`${ADDRESS}x`, 'invalid'],
    ['11111111111111111111111111111111', 'zero'],
  ] as const)('%j -> %s', (text, reason) => {
    expect(parseAddressInput(text)).toEqual({ ok: false, reason });
  });

  it('each problem has its own text', () => {
    expect(addressInputError('empty')).toBe('Paste an address first.');
    expect(addressInputError('invalid')).toBe('This is not a Solana address.');
    expect(addressInputError('zero')).toBe('This is the empty address, not a wallet.');
  });
});

describe('AddressField', () => {
  function Field({ error, onChange }: { error: string | null; onChange: (text: string) => void }) {
    const [value, setValue] = useState('');
    return (
      <AddressField
        label="Second key address"
        hint="Paste the address of the wallet that will be your second key."
        value={value}
        onChange={(text) => {
          setValue(text);
          onChange(text);
        }}
        error={error}
      />
    );
  }

  it('a labelled monospace field with its hint read along; no spell check or autocomplete', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Field error={null} onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'Second key address' });
    expect(input).toHaveAccessibleDescription('Paste the address of the wallet that will be your second key.');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('spellcheck', 'false');
    expect(input).toHaveClass('font-mono');
    expect(input).not.toHaveAttribute('aria-invalid');
    await user.type(input, ADDRESS);
    expect(onChange).toHaveBeenLastCalledWith(ADDRESS);
    expect(input).toHaveValue(ADDRESS);
  });

  it('an error is shown under the field and read with it', () => {
    render(<Field error="This is not a Solana address." onChange={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: 'Second key address' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(
      'Paste the address of the wallet that will be your second key. This is not a Solana address.',
    );
  });
});
