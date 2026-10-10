import type { Address } from '@solana/kit';
import { formatUtcDate, formatUtcDateTime } from '@stakeward/core';
import { BellRingIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { WatchedAccount, WatchedEvent } from '@/api/accounts';
import { Section } from '@/components/layout/Section';
import { Skeleton } from '@/components/ui/skeleton';
import { t, type MessageKey } from '@/i18n';
import { AddressText } from './address-text.tsx';
import { ErrorState } from './error-state.tsx';

type Common = { event: string; stake: Address; className?: string | undefined };

export type AlertExplanationProps =
  | (Common & { state: 'loading' })
  | (Common & { state: 'error'; detail?: string | undefined; onRetry?: (() => void) | undefined })
  | (Common & {
      state: 'ready';
      /** When the monitor saw this event; null when the worker has no record of it (a reminder, or an old event). */
      detectedAt: Date | null;
      /** The account as the monitor last stored it; null when it is not watched any more. */
      current: WatchedAccount | null;
      /** The account's other recent events, newest first. */
      recent: readonly WatchedEvent[];
    });

const EVENT_WORDS: Record<string, MessageKey> = {
  DEACTIVATED: 'alertExplain.events.DEACTIVATED',
  DELEGATION_CHANGED: 'alertExplain.events.DELEGATION_CHANGED',
  STAKER_CHANGED: 'alertExplain.events.STAKER_CHANGED',
  WITHDRAWER_CHANGED: 'alertExplain.events.WITHDRAWER_CHANGED',
  LOCKUP_CHANGED: 'alertExplain.events.LOCKUP_CHANGED',
  BALANCE_DECREASED: 'alertExplain.events.BALANCE_DECREASED',
  ACCOUNT_CLOSED: 'alertExplain.events.ACCOUNT_CLOSED',
  EXPIRED: 'alertExplain.events.EXPIRED',
};

/** An event type in plain words; a type this site does not know yet reads as "a change". */
export function alertEventText(event: string): string {
  if (/^REMINDER_[0-9]+$/.test(event)) return t('alertExplain.events.REMINDER');
  const key = Object.hasOwn(EVENT_WORDS, event) ? EVENT_WORDS[event] : undefined;
  return t(key ?? 'alertExplain.events.other');
}

/** "Locked · delegated", or "Not watched any more" without a stored row. */
export function alertStatusText(current: WatchedAccount | null): string {
  if (current === null) return t('alertExplain.notWatched');
  return `${t(`alertExplain.lock.${current.lock}`)} · ${t(`alertExplain.state.${current.state}`)}`;
}

/** The lock end as a date, or "No lock". */
export function alertLockEndText(current: WatchedAccount | null): string {
  if (current === null || current.lock === 'ended') return t('alertExplain.noLock');
  return formatUtcDate(current.lockUntil) ?? t('alertExplain.unknown');
}

/** A time as "12 April 2027, 10:30 UTC". */
export function alertTimeText(date: Date | null): string {
  if (date === null) return t('alertExplain.unknown');
  return formatUtcDateTime(BigInt(Math.floor(date.getTime() / 1000))) ?? t('alertExplain.unknown');
}

/**
 * "Explain this alert" (DECISIONS.md D125): the page a Telegram alert opens says which alert it was, in plain words,
 * with what the monitor stored about the account (GET /api/accounts) and its recent changes. The event and the account
 * come from the link and are shown as text; the rest from the worker, which read them from the network.
 */
export function AlertExplanation(props: AlertExplanationProps) {
  return (
    <Section title={t('alertExplain.title')} description={t('alertExplain.lead')} className={props.className}>
      <div
        data-slot="alert-explanation"
        data-state={props.state}
        className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
      >
        <dl className="flex flex-col gap-3 text-sm">
          <Row label={t('alertExplain.event')}>
            <span className="flex items-start gap-2 font-medium">
              <BellRingIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
              {alertEventText(props.event)}
            </span>
          </Row>
          <Row label={t('alertExplain.account')}>
            <AddressText address={props.stake} />
          </Row>
          {props.state === 'ready' ? (
            <>
              <Row label={t('alertExplain.when')}>{alertTimeText(props.detectedAt)}</Row>
              <Row label={t('alertExplain.now')}>{alertStatusText(props.current)}</Row>
              <Row label={t('alertExplain.lockEnd')}>{alertLockEndText(props.current)}</Row>
            </>
          ) : null}
        </dl>
        {props.state === 'loading' ? (
          <div aria-busy="true" className="flex flex-col gap-2">
            <p role="status" className="text-sm text-muted">
              {t('alertExplain.loading')}
            </p>
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : props.state === 'error' ? (
          <ErrorState title={t('alertExplain.errorTitle')} message={t('alertExplain.error')} detail={props.detail} onRetry={props.onRetry} />
        ) : (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{t('alertExplain.recent')}</h3>
            {props.recent.length === 0 ? (
              <p className="text-sm text-muted">{t('alertExplain.noRecent')}</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {props.recent.map((event) => (
                  <li key={`${event.type}-${String(event.detectedAt.getTime())}`} className="flex flex-col sm:flex-row sm:gap-2">
                    <span className="text-muted tabular-nums">{alertTimeText(event.detectedAt)}</span>
                    <span>{alertEventText(event.type)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-muted sm:w-36">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
