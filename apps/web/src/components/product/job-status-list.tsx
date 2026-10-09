import type { Address, Signature } from '@solana/kit';
import { cn } from 'cn';
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleMinusIcon,
  CircleQuestionMarkIcon,
  CircleSlashIcon,
  CircleXIcon,
  HourglassIcon,
  SearchIcon,
  SendIcon,
  TimerOffIcon,
  type LucideIcon,
} from 'lucide-react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { t, type MessageKey } from '@/i18n';
import { AddressText } from './address-text.tsx';
import { ErrorDetails } from './error-state.tsx';

export type JobStatus =
  | 'waiting'
  | 'sending'
  | 'confirming'
  | 'checking'
  | 'done'
  | 'failed'
  | 'expired'
  | 'unknown'
  | 'not-sent'
  | 'left-out';

/** One stake account's transaction and where it stands. */
export type JobStatusItem = {
  /** The stake account. */
  address: Address;
  status: JobStatus;
  /** What happened and what to do next, in plain words (the page maps the engine's state to text). */
  reason?: string | undefined;
  /** Original error text, shown under "Details" (UX rule 8). */
  detail?: string | undefined;
  /** The fee payer's signature once known: the transaction's explorer link (UX rule 9). */
  signature?: Signature | null | undefined;
};

type Look = { tone: NonNullable<BadgeProps['tone']>; icon: LucideIcon; label: MessageKey };

/** Word + colour + icon for each status (UX rule 5): colour is never the only signal. */
const LOOKS: Record<JobStatus, Look> = {
  waiting: { tone: 'outline', icon: CircleDashedIcon, label: 'components.jobs.status.waiting' },
  sending: { tone: 'info', icon: SendIcon, label: 'components.jobs.status.sending' },
  confirming: { tone: 'info', icon: HourglassIcon, label: 'components.jobs.status.confirming' },
  checking: { tone: 'info', icon: SearchIcon, label: 'components.jobs.status.checking' },
  done: { tone: 'success', icon: CircleCheckIcon, label: 'components.jobs.status.done' },
  failed: { tone: 'danger', icon: CircleXIcon, label: 'components.jobs.status.failed' },
  expired: { tone: 'warning', icon: TimerOffIcon, label: 'components.jobs.status.expired' },
  unknown: { tone: 'warning', icon: CircleQuestionMarkIcon, label: 'components.jobs.status.unknown' },
  'not-sent': { tone: 'neutral', icon: CircleSlashIcon, label: 'components.jobs.status.notSent' },
  'left-out': { tone: 'neutral', icon: CircleMinusIcon, label: 'components.jobs.status.leftOut' },
};

/**
 * One line per stake account of a signing run (CLAUDE.md section 5: accounts are independent, so each shows its own
 * outcome): the short address with copy and explorer link, the status in a word, a colour and an icon, the reason,
 * the raw error under "Details" and the transaction's explorer link. Presentational.
 */
export function JobStatusList({
  items,
  label,
  className,
}: {
  items: readonly JobStatusItem[];
  /** Accessible name of the list, e.g. "Stake accounts". */
  label: string;
  className?: string | undefined;
}) {
  return (
    <ul aria-label={label} data-slot="job-status-list" className={cn('flex flex-col gap-2', className)}>
      {items.map((item) => {
        const { tone, icon: Icon, label: word } = LOOKS[item.status];
        return (
          <li
            key={item.address}
            data-status={item.status}
            className={cn(
              'flex flex-col gap-2 rounded-md border bg-surface p-3',
              item.status === 'failed' ? 'border-danger-border' : 'border-border',
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <AddressText address={item.address} />
              <Badge tone={tone} data-status={item.status}>
                <Icon aria-hidden="true" />
                {t(word)}
              </Badge>
            </div>
            {item.reason === undefined || item.reason === '' ? null : <p className="text-sm">{item.reason}</p>}
            {item.detail === undefined ? null : <ErrorDetails detail={item.detail} />}
            {item.signature === undefined || item.signature === null ? null : (
              <div className="flex flex-wrap items-center gap-x-2 text-sm">
                <span className="text-muted">{t('components.jobs.transaction')}</span>
                <AddressText address={item.signature} kind="tx" />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
