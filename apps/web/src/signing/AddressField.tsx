import { isAddress, type Address } from '@solana/kit';
import { ZERO_ADDRESS } from '@stakeward/core';
import { CircleAlertIcon } from 'lucide-react';
import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t } from '@/i18n';

export type AddressInputProblem = 'empty' | 'invalid' | 'zero';

/**
 * A pasted wallet address: trimmed, a valid Solana address, and not the all-zero address (the System program's id,
 * which no wallet holds).
 */
export function parseAddressInput(text: string): { ok: true; address: Address } | { ok: false; reason: AddressInputProblem } {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, reason: 'empty' };
  if (!isAddress(trimmed)) return { ok: false, reason: 'invalid' };
  if (trimmed === ZERO_ADDRESS) return { ok: false, reason: 'zero' };
  return { ok: true, address: trimmed };
}

/** The field's error text for a problem of `parseAddressInput`. */
export function addressInputError(reason: AddressInputProblem): string {
  return t(`components.addressField.${reason}`);
}

type AddressFieldProps = {
  label: string;
  hint: string;
  value: string;
  onChange: (text: string) => void;
  /** Shown under the field and linked to it; null while there is nothing to say. */
  error: string | null;
};

/**
 * A labelled field for one wallet address typed or pasted by the user (a key that signs on another device). The hint
 * and the error are read with the field (aria-describedby); the page decides when to show an error.
 */
export function AddressField({ label, hint, value, onChange, error }: AddressFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div data-slot="address-field" className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <p id={hintId} className="text-sm text-muted">
        {hint}
      </p>
      <Input
        id={id}
        type="text"
        value={value}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-invalid={error === null ? undefined : true}
        aria-describedby={error === null ? hintId : `${hintId} ${errorId}`}
        className="font-mono"
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {error === null ? null : (
        <p id={errorId} className="flex items-start gap-2 text-sm font-medium text-danger">
          <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
