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
 * - the four scanner statuses of core `scannerStatus` (a lock held by a key the viewer is not known to hold is
 *   Locked by another key, never Protected: the chain cannot say whose key it is);
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

export function statusLabel(status: StatusBadgeStatus): string {
  return t(LOOKS[status].label);
}

type StatusBadgeProps = { status: StatusBadgeStatus; className?: string | undefined };

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { tone, icon: Icon, label } = LOOKS[status];
  return (
    <Badge tone={tone} data-status={status} className={cn('text-sm', className)}>
      <Icon aria-hidden="true" />
      {t(label)}
    </Badge>
  );
}

/** Loading state: the badge's footprint, decorative (the surrounding region announces loading). */
export function StatusBadgeSkeleton({ className }: { className?: string | undefined }) {
  return <Skeleton className={cn('h-6 w-28 rounded-full', className)} />;
}
