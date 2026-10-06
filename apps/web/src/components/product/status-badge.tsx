import type { ProtectionStatus } from '@stakeward/core';
import { cn } from 'cn';
import {
  CircleQuestionMarkIcon,
  KeyRoundIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  ShieldXIcon,
  type LucideIcon,
} from 'lucide-react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { t, type MessageKey } from '@/i18n';

/**
 * Everything a stake account's protection can show (CLAUDE.md section 5, D14):
 * - the four scanner statuses of core `scannerStatus`. A lock held by a key the viewer is not known to hold is never
 *   Protected: the chain cannot say whose key it is. It reads Locked by a second key while this browser knows no second
 *   key (on a new device it is the viewer's own lock as often as someone else's), and Locked by another key once it
 *   knows one that does not hold it (what a fake site leaves, D35);
 * - `was-protected`: F6, the account was protected and now stands without a lock (red);
 * - `unknown`: the account could not be read (error state).
 */
export type StatusBadgeStatus = ProtectionStatus | 'was-protected' | 'unknown';

type Look = { tone: NonNullable<BadgeProps['tone']>; icon: LucideIcon; label: MessageKey };

/** Word + colour + icon for each status (UX rule 5): colour is never the only signal. */
const LOOKS: Record<StatusBadgeStatus, Look> = {
  protected: { tone: 'success', icon: ShieldCheckIcon, label: 'status.protected' },
  expiring: { tone: 'warning', icon: ShieldAlertIcon, label: 'status.expiring' },
  unprotected: { tone: 'neutral', icon: ShieldOffIcon, label: 'status.unprotected' },
  'locked-by-other': { tone: 'info', icon: KeyRoundIcon, label: 'status.lockedByOther' },
  'was-protected': { tone: 'danger', icon: ShieldXIcon, label: 'components.status.wasProtected' },
  unknown: { tone: 'outline', icon: CircleQuestionMarkIcon, label: 'components.status.unknown' },
};

/** `locked-by-other` once this browser knows a second key, none of which holds the lock: the same tone and icon. */
const LOCKED_BY_ANOTHER: MessageKey = 'status.lockedByAnother';

function labelOf(status: StatusBadgeStatus, secondKeyKnown: boolean): MessageKey {
  return status === 'locked-by-other' && secondKeyKnown ? LOCKED_BY_ANOTHER : LOOKS[status].label;
}

export function statusLabel(status: StatusBadgeStatus, secondKeyKnown = false): string {
  return t(labelOf(status, secondKeyKnown));
}

type StatusBadgeProps = {
  status: StatusBadgeStatus;
  /** This browser knows a second key for the account's main key (only `locked-by-other` reads differently). */
  secondKeyKnown?: boolean | undefined;
  className?: string | undefined;
};

export function StatusBadge({ status, secondKeyKnown = false, className }: StatusBadgeProps) {
  const { tone, icon: Icon } = LOOKS[status];
  return (
    <Badge tone={tone} data-status={status} className={cn('text-sm', className)}>
      <Icon aria-hidden="true" />
      {t(labelOf(status, secondKeyKnown))}
    </Badge>
  );
}

/** Loading state: the badge's footprint, decorative (the surrounding region announces loading). */
export function StatusBadgeSkeleton({ className }: { className?: string | undefined }) {
  return <Skeleton className={cn('h-6 w-28 rounded-full', className)} />;
}
