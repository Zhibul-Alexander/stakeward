import { aiPrompt, formatSol, formatUtcDate, isLockupInForce, runTheftTest, type ChainClock, type ChainPort, type StakeAccount, type TheftResult, type TheftVerdict } from '@stakeward/core';
import { CircleQuestionMarkIcon, ClockIcon, ShieldCheckIcon, ShieldXIcon, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'wouter';
import { AskAi } from '@/components/product/ask-ai';
import { Disclosure } from '@/components/product/disclosure';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { appLinks } from '@/pages/app/view';

const LOOKS: Record<TheftVerdict, { tone: NonNullable<BadgeProps['tone']>; icon: LucideIcon }> = {
  blocked: { tone: 'success', icon: ShieldCheckIcon },
  'would-succeed': { tone: 'danger', icon: ShieldXIcon },
  'after-unstaking': { tone: 'warning', icon: ClockIcon },
  unknown: { tone: 'outline', icon: CircleQuestionMarkIcon },
};

/** The whole outcome in one line: safe when both are blocked, exposed when any would go through. */
export function theftSummary(results: readonly TheftResult[]): 'safe' | 'exposed' | 'partial' {
  if (results.some((result) => result.verdict === 'would-succeed' || result.verdict === 'after-unstaking')) return 'exposed';
  return results.every((result) => result.verdict === 'blocked') ? 'safe' : 'partial';
}

function reason(result: TheftResult, lockUntil: bigint): string {
  if (result.verdict !== 'unknown') return t(`steal.explain.${result.verdict}`);
  if (result.code === 'insufficient-funds') return t('steal.noFee');
  return errorMessage({ code: result.code ?? 'unknown' }, lockUntil);
}

/** The question for the person's own AI (D122): public facts and what the network answered. */
export function theftPrompt(account: StakeAccount, clock: ChainClock, results: readonly TheftResult[]): string {
  const locked = isLockupInForce(account.lockup, clock);
  return aiPrompt({
    task: t('steal.aiTask'),
    facts: [
      ['Stake account', account.address],
      ['Balance', `${formatSol(account.lamports)} SOL`],
      ['Lock', locked ? `in force until ${formatUtcDate(account.lockup.unixTimestamp) ?? String(account.lockup.unixTimestamp)}` : 'none'],
      ...results.map((result): [string, string] => [
        `Simulated as a thief with only the main key: ${t(`steal.attempts.${result.attempt}`)}`,
        `${t(`steal.verdicts.${result.verdict}`)}${result.code === null ? '' : ` (${result.code})`}`,
      ]),
    ],
    verdict: t(`steal.summary.${theftSummary(results)}`),
  });
}

type TheftTestProps = { chain: ChainPort; account: StakeAccount; clock: ChainClock };

/**
 * "Try to steal it" (DECISIONS.md D123): simulates, as a thief with only the main key, a withdraw of everything and
 * removing the lock, and shows what the network answered. Read-only; no wallet.
 */
export function TheftTest({ chain, account, clock }: TheftTestProps) {
  const titleId = useId();
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'running' } | { kind: 'done'; results: readonly TheftResult[] }>({ kind: 'idle' });
  const run = useRef(0);
  useEffect(
    () => () => {
      run.current += 1;
    },
    [],
  );

  async function start() {
    run.current += 1;
    const mine = run.current;
    setState({ kind: 'running' });
    const results = await runTheftTest(chain, account);
    if (run.current === mine) setState({ kind: 'done', results });
  }

  const results = state.kind === 'done' ? state.results : null;
  const summary = results === null ? null : theftSummary(results);
  return (
    <section aria-labelledby={titleId} data-slot="theft-test" className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 id={titleId} className="text-lg font-semibold text-balance">
          {t('steal.heading')}
        </h2>
        <p className="text-sm text-muted">{t('steal.simulationOnly')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant={results === null ? 'primary' : 'outline'}
          disabled={state.kind === 'running'}
          onClick={() => {
            void start();
          }}
        >
          {results === null ? t('steal.run') : t('steal.runAgain')}
        </Button>
        {state.kind === 'running' ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <Spinner aria-hidden="true" />
            {t('steal.running')}
          </p>
        ) : null}
      </div>
      {results === null || summary === null ? null : (
        <div className="flex flex-col gap-4" aria-live="polite">
          <ul className="flex flex-col gap-3">
            {results.map((result) => {
              const { tone, icon: Icon } = LOOKS[result.verdict];
              return (
                <li key={result.attempt} data-attempt={result.attempt} className="flex flex-col gap-1 border-t border-border pt-3 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{t(`steal.attempts.${result.attempt}`)}</span>
                    <Badge tone={tone} size="md" data-verdict={result.verdict}>
                      <Icon aria-hidden="true" />
                      {t(`steal.verdicts.${result.verdict}`)}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted">{reason(result, account.lockup.unixTimestamp)}</p>
                  {result.detail === '' ? null : (
                    <Disclosure summary={t('steal.details')}>
                      <pre className="mt-2 overflow-auto rounded-md bg-subtle p-3 font-mono text-xs whitespace-pre-wrap break-words">{result.detail}</pre>
                    </Disclosure>
                  )}
                </li>
              );
            })}
          </ul>
          <p className={summary === 'exposed' ? 'font-medium text-danger' : summary === 'safe' ? 'font-medium text-success' : 'font-medium'}>
            {t(`steal.summary.${summary}`)}
          </p>
          {summary === 'exposed' ? (
            <div>
              <Button asChild>
                <Link href={appLinks.protect([account.address])}>{t('steal.protect')}</Link>
              </Button>
            </div>
          ) : null}
          <p className="text-sm text-muted">{t('steal.still')}</p>
          <AskAi prompt={theftPrompt(account, clock, results)} />
        </div>
      )}
    </section>
  );
}
