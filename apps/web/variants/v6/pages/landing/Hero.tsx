import { isAddress, type Address } from '@solana/kit';
import { ZERO_ADDRESS, type Cluster } from '@stakeward/core';
import { useId, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

type Problem = 'empty' | 'invalid' | 'zero';

function problemOf(text: string): Problem | null {
  if (text === '') return 'empty';
  if (!isAddress(text)) return 'invalid';
  return text === ZERO_ADDRESS ? 'zero' : null;
}

const PROBLEM_TEXT = {
  empty: 'app.form.empty',
  invalid: 'app.form.invalid',
  zero: 'app.form.zero',
} as const;

/**
 * v6 "Verdict first": the landing page is one question and one field. The visitor pastes the wallet they staked from
 * and gets the answer on /app?address= (UX rule 1: look first; nothing to connect, nothing to sign). The other ways in
 * (protect directly, the demo) are quiet text links under the field.
 */
export function Hero({ cluster }: { cluster: Cluster }) {
  const [, navigate] = useLocation();
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const devnet = cluster === 'devnet';

  return (
    <section aria-labelledby="landing-title" className="flex flex-col gap-10 sm:gap-14">
      <h1 id="landing-title" className="max-w-5xl text-display text-balance">
        {t('landing.title')}
      </h1>
      <form
        noValidate
        className="flex max-w-4xl flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const address = text.trim();
          const found = problemOf(address);
          setProblem(found);
          if (found !== null) {
            input.current?.focus();
            return;
          }
          navigate(`/app?${new URLSearchParams({ address: address as Address }).toString()}`);
        }}
      >
        <label htmlFor={id} className="text-lg font-semibold">
          Paste the wallet you staked from
        </label>
        <div className="flex flex-col gap-3 md:flex-row">
          <input
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
            onChange={(event) => {
              setText(event.target.value);
            }}
            className="h-16 w-full min-w-0 rounded-md md:flex-1 border-2 border-border-strong bg-surface px-4 font-mono text-base text-foreground aria-invalid:border-danger sm:text-lg"
          />
          <Button type="submit" size="lg" className="h-16 md:px-10">
            Get the answer
          </Button>
        </div>
        {problem === null ? null : (
          <p id={errorId} role="alert" className="text-sm font-medium text-danger">
            {t(PROBLEM_TEXT[problem])}
          </p>
        )}
        <p id={hintId} className="text-sm text-muted">
          {t('landing.checkStakeHint')} {devnet ? t('landing.network.devnetNote') : t('landing.network.mainnetNote')}
        </p>
        <p className="flex flex-wrap gap-x-6 gap-y-2 pt-2 text-base">
          <Link href="/protect" className="rounded-sm font-medium underline decoration-2 underline-offset-4 hover:decoration-4">
            {t('landing.protectStake')}
          </Link>
          <Link href="/demo" className="rounded-sm font-medium underline decoration-2 underline-offset-4 hover:decoration-4">
            {t('landing.demoLink')}
          </Link>
        </p>
      </form>
    </section>
  );
}
