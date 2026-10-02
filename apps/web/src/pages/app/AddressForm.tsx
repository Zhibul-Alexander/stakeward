import { isAddress, type Address } from '@solana/kit';
import { ZERO_ADDRESS } from '@stakeward/core';
import { SearchIcon } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t } from '@/i18n';

type Problem = 'empty' | 'invalid' | 'zero';

function problemOf(text: string): Problem | null {
  if (text === '') return 'empty';
  if (!isAddress(text)) return 'invalid';
  // The System Program's id: no wallet, and as a second key it would match almost every stake account (no lock).
  return text === ZERO_ADDRESS ? 'zero' : null;
}

/** An address the accounts page reads: a Solana address other than the all-zero one (problemOf). */
export function isCheckableAddress(text: string): text is Address {
  return problemOf(text) === null;
}

/** An address from the URL that is not one says so right away; an empty field only after a submit. */
const initialProblem = (value: string) => (value === '' ? null : problemOf(value));

/**
 * Paste an address, check it, show its stake (UX rule 1: look first, connect later). `value` is the address in the
 * URL: when it changes (history back and forth, a connected main key) the field follows it.
 */
export function AddressForm({ value, onSubmit }: { value: string; onSubmit: (address: Address) => void }) {
  const [text, setText] = useState(value);
  const [problem, setProblem] = useState<Problem | null>(() => initialProblem(value));
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setText(value);
    setProblem(initialProblem(value));
  }
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <form
      noValidate
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const address = text.trim();
        const found = problemOf(address);
        setProblem(found);
        if (found !== null) {
          input.current?.focus();
          return;
        }
        setText(address);
        onSubmit(address as Address);
      }}
    >
      <Label htmlFor={id}>{t('app.form.label')}</Label>
      <p id={hintId} className="text-sm text-muted">
        {t('app.form.hint')}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          ref={input}
          id={id}
          name="address"
          type="text"
          value={text}
          placeholder={t('app.form.placeholder')}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={problem !== null}
          aria-describedby={problem === null ? hintId : `${hintId} ${errorId}`}
          className="font-mono"
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <Button type="submit" className="sm:w-auto">
          <SearchIcon aria-hidden="true" />
          {t('app.form.submit')}
        </Button>
      </div>
      {problem === null ? null : (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger">
          {t(problem === 'empty' ? 'app.form.empty' : problem === 'zero' ? 'app.form.zero' : 'app.form.invalid')}
        </p>
      )}
    </form>
  );
}
