import { formatUtcDate, formatUtcDateTime } from '@stakeward/core';
import { cn } from 'cn';
import { ShieldAlertIcon, TriangleAlertIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { t, type MessageKey } from '@/i18n';
import { keepTogether } from './countdown.tsx';

/**
 * Risks said before the action, in plain words and with the date (UX rule 6). Pages pick one of these instead of
 * writing their own wording, so the same risk reads the same everywhere.
 * - `lose-second-key` (date = lock end T): protect and extend.
 * - `second-key-can-freeze`: protect, choosing the second key (CLAUDE.md section 1, honest limitation).
 * - `withdraw-compromised`: withdraw (F3 step 3).
 * - `unlock-opens-window`: removing the lock early (F3 step 4, F5).
 * - `lock-ends` (date = T): an expiring lock.
 */
export type RiskKind = 'lose-second-key' | 'second-key-can-freeze' | 'withdraw-compromised' | 'unlock-opens-window' | 'lock-ends';

const TEXT: Record<RiskKind, { key: MessageKey; needsDate: boolean }> = {
  'lose-second-key': { key: 'components.risk.loseSecondKey', needsDate: true },
  'second-key-can-freeze': { key: 'components.risk.secondKeyCanFreeze', needsDate: false },
  'withdraw-compromised': { key: 'components.risk.withdrawCompromised', needsDate: false },
  'unlock-opens-window': { key: 'components.risk.unlockOpensWindow', needsDate: false },
  'lock-ends': { key: 'components.risk.lockEnds', needsDate: true },
};

export type DateStyle = 'date' | 'date-time';

type RiskNoteProps = {
  risk: RiskKind;
  /** Unix seconds; required by `lose-second-key` and `lock-ends`. */
  date?: bigint | undefined;
  /**
   * `date` (default): "12 April 2027". `date-time`: "12 April 2027, 00:00 UTC", for the recovery card, whose reader
   * may live in any time zone (DECISIONS.md D74).
   */
  dateStyle?: DateStyle | undefined;
  /** `danger` when the action is about to remove protection; `warning` otherwise. */
  tone?: 'warning' | 'danger' | undefined;
  /**
   * `block` (default): a soft alert of the tone. `inline`: one line of text with the tone's icon and no fill, for the
   * ActionBar right above the button it guards (DECISIONS.md D112). The words and the date are the same.
   */
  variant?: 'block' | 'inline' | undefined;
  /** Extra sentences after the risk. */
  children?: ReactNode;
  className?: string | undefined;
};

/**
 * The risk text for `risk`, or null when it needs a date that is missing or out of range. `dateOnOneLine` joins the
 * date's words with non-breaking spaces, as the note renders it: a narrow screen must not split "until 3" / "April 2027".
 */
export function riskText(risk: RiskKind, date?: bigint, dateStyle: DateStyle = 'date', dateOnOneLine = false): string | null {
  const { key, needsDate } = TEXT[risk];
  if (!needsDate) return t(key);
  const format = dateStyle === 'date-time' ? formatUtcDateTime : formatUtcDate;
  const formatted = date === undefined ? null : format(date);
  if (formatted === null) return null;
  return t(key, { date: dateOnOneLine ? keepTogether(formatted) : formatted });
}

export function RiskNote({ risk, date, dateStyle = 'date', tone = 'warning', variant = 'block', children, className }: RiskNoteProps) {
  const text = riskText(risk, date, dateStyle, true);
  if (text === null) return null;
  if (variant === 'inline') {
    const Icon = tone === 'danger' ? ShieldAlertIcon : TriangleAlertIcon;
    return (
      <div
        role="note"
        data-slot="risk-note"
        data-risk={risk}
        data-variant="inline"
        data-tone={tone}
        className={cn('flex items-start gap-2 text-sm font-medium text-foreground', className)}
      >
        <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', tone === 'danger' ? 'text-danger' : 'text-warning')} />
        <div className="flex min-w-0 flex-col gap-1">
          <p>{text}</p>
          {children}
        </div>
      </div>
    );
  }
  return (
    <Alert tone={tone} role="note" data-risk={risk} className={className}>
      <TriangleAlertIcon aria-hidden="true" />
      <AlertDescription className="flex flex-col gap-1 text-foreground">
        <p className="font-medium">{text}</p>
        {children}
      </AlertDescription>
    </Alert>
  );
}
