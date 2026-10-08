import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Badge } from '@/components/ui/badge';
import { RadioCardGroup, type RadioCardOption } from './radio-card.tsx';

const OPTIONS: RadioCardOption[] = [
  { value: '3', title: '3 months', meta: 'until 3 January 2027' },
  { value: '6', title: '6 months', meta: 'until 3 April 2027', badge: <Badge tone="success">Recommended</Badge> },
  { value: 'remove', title: 'Remove the lock now', description: 'Your main key alone can then withdraw.', tone: 'danger' },
];

function Controlled({ onChange, options = OPTIONS }: { onChange: (value: string) => void; options?: RadioCardOption[] }) {
  const [value, setValue] = useState('6');
  return (
    <RadioCardGroup
      legend="New end of the lock"
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      options={options}
      columns={2}
    />
  );
}

describe('RadioCardGroup', () => {
  it('names each radio by its title alone and describes it with its date and line; the choice is a visible radio', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    expect(screen.getByRole('radiogroup', { name: 'New end of the lock' })).toBeInTheDocument();
    const six = screen.getByRole('radio', { name: '6 months' });
    expect(six).toBeChecked();
    expect(six).toHaveAccessibleDescription('until 3 April 2027');
    expect(screen.getByText('Recommended')).toBeInTheDocument();
    const remove = screen.getByRole('radio', { name: 'Remove the lock now' });
    expect(remove).toHaveAccessibleDescription('Your main key alone can then withdraw.');

    // A click anywhere on the card chooses its option, not only on the radio.
    await user.click(screen.getByText('until 3 January 2027'));
    expect(onChange).toHaveBeenLastCalledWith('3');
    expect(screen.getByRole('radio', { name: '3 months' })).toBeChecked();
    expect(six).not.toBeChecked();
  });

  it('sets a danger option apart, after a separator, with its title in danger text', () => {
    render(<Controlled onChange={vi.fn()} />);
    const cards = [...document.querySelectorAll('[data-slot="radio-card"]')];
    expect(cards.map((card) => card.getAttribute('data-tone'))).toEqual(['default', 'default', 'danger']);
    expect(cards[2]?.previousElementSibling).toHaveAttribute('data-slot', 'separator');
    expect(screen.getByText('Remove the lock now')).toHaveClass('text-danger');
    expect(screen.getByText('6 months')).not.toHaveClass('text-danger');
  });

  it('a disabled option says why and cannot be chosen', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Controlled
        onChange={onChange}
        options={[
          { value: 'here', title: 'In this browser' },
          { value: 'link', title: 'By link', description: 'Needs a deposit.', disabledReason: 'Not possible without a lock.' },
        ]}
      />,
    );
    const link = screen.getByRole('radio', { name: 'By link' });
    expect(link).toBeDisabled();
    expect(link).toHaveAccessibleDescription('Needs a deposit. Not possible without a lock.');
    await user.click(screen.getByText('By link'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
