import { formatUtcDate } from '@stakeward/core';
import { TriangleAlertIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { t, type MessageKey } from '@/i18n';

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

type RiskNoteProps = {
  risk: RiskKind;
  /** Unix seconds; required by `lose-second-key` and `lock-ends`. */
  date?: bigint | undefined;
  /** `danger` when the action is about to remove protection; `warning` otherwise. */
  tone?: 'warning' | 'danger' | undefined;
  /** Extra sentences after the risk. */
  children?: ReactNode;
  className?: string | undefined;
};

/** The risk text for `risk`, or null when it needs a date that is missing or out of range. */
export function riskText(risk: RiskKind, date?: bigint): string | null {
  const { key, needsDate } = TEXT[risk];
  if (!needsDate) return t(key);
  const formatted = date === undefined ? null : formatUtcDate(date);
  return formatted === null ? null : t(key, { date: formatted });
}

export function RiskNote({ risk, date, tone = 'warning', children, className }: RiskNoteProps) {
  const text = riskText(risk, date);
  if (text === null) return null;
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
