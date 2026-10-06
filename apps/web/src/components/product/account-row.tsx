import { formatUtcDate, shortAddress, type ActivationStatus, type ProtectionStatus, type StakeAccount } from '@stakeward/core';
import { cn } from 'cn';
import {
  ActivityIcon,
  CirclePauseIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { t, type MessageKey } from '@/i18n';
import { AddressText } from './address-text.tsx';
import { ErrorState } from './error-state.tsx';
import { SolAmount } from './sol-amount.tsx';
import { StatusBadge, type StatusBadgeStatus } from './status-badge.tsx';

const ACTIVATION_ICON: Record<ActivationStatus, LucideIcon> = {
  active: ActivityIcon,
  activating: TrendingUpIcon,
  deactivating: TrendingDownIcon,
  inactive: CirclePauseIcon,
};

/** Staking state by epochs (core `stakeActivationStatus`): word and icon, neutral colour (it is not a risk). */
export function ActivationBadge({ status, className }: { status: ActivationStatus; className?: string | undefined }) {
  const Icon = ACTIVATION_ICON[status];
  return (
    <Badge tone="outline" data-activation={status} className={cn('text-sm', className)}>
      <Icon aria-hidden="true" />
      {t(`components.activation.${status}`)}
    </Badge>
  );
}

type AccountRowProps = {
  account: Pick<StakeAccount, 'address' | 'lamports' | 'lockup'>;
  activation: ActivationStatus;
  /** From core `scannerStatus`. */
  protection: ProtectionStatus;
  /**
   * From core `scannerStatus`: staker != withdrawer. Without a lock of the viewer's second key a service may manage the
   * stake; under one (Protected, Expiring) it is what a thief with the main key does first, so the row says so.
   */
  managedByService: boolean;
  /** Rescue for this account's main key (`/rescue?address=`): linked from that warning. Left out on the rescue pages. */
  rescueHref?: string | undefined;
  /**
   * This browser knows a second key for the account's main key: the list core `scannerStatus` got was not empty. With
   * one, a `locked-by-other` lock is held by none of them and reads Locked by another key, with no "connect it" (what a
   * fake site leaves, D35); without, Locked by a second key, which on a new device is the viewer's own lock too.
   */
  secondKeyKnown: boolean;
  /** F6: this account was protected and its lock is gone. With `protection: 'unprotected'` it shows red. */
  wasProtected?: boolean | undefined;
  /** Buttons or a selection checkbox for this account. */
  actions?: ReactNode;
  className?: string | undefined;
};

const HINTS: Record<StatusBadgeStatus, MessageKey | null> = {
  protected: 'status.protectedHint',
  expiring: 'status.expiringHint',
  unprotected: 'status.unprotectedHint',
  'locked-by-other': 'status.lockedByOtherHint',
  'was-protected': 'components.status.wasProtectedHint',
  unknown: 'components.status.unknownHint',
};

/**
 * One stake account in the accounts list: short address (copy, explorer), SOL, staking state, protection status
 * with the lock end date, the hint that goes with the status, the managed-by-service warning (or, under the viewer's
 * own lock, the warning that another key can stop or move the stake, with Rescue) and an action slot.
 * The caller computes the statuses with core (`scannerStatus`, `stakeActivationStatus`); this renders them.
 */
export function AccountRow({
  account,
  activation,
  protection,
  managedByService,
  secondKeyKnown,
  wasProtected = false,
  rescueHref,
  actions,
  className,
}: AccountRowProps) {
  const lockInForce = protection !== 'unprotected';
  const status: StatusBadgeStatus = protection === 'unprotected' && wasProtected ? 'was-protected' : protection;
  // The end date only for a lock its timestamp alone holds (epoch 0, as Stakeward sets it): a lock with an epoch can
  // last past its timestamp, so its date would be wrong or already past.
  const date =
    lockInForce && account.lockup.epoch === 0n && account.lockup.unixTimestamp > 0n
      ? formatUtcDate(account.lockup.unixTimestamp)
      : null;
  const short = shortAddress(account.address);
  const hintKey = status === 'locked-by-other' && secondKeyKnown ? 'status.lockedByAnotherHint' : HINTS[status];
  const hint = hintKey === null ? null : t(hintKey, { date: date ?? '' });
  // Another stake key under the viewer's own lock (SECURITY-CHECK П6): a thief with the main key can still stop or move
  // the stake, and this is what it looks like.
  const stakeKeyChanged = managedByService && (status === 'protected' || status === 'expiring');
  return (
    <article
      aria-label={t('components.accountRow.label', { address: short })}
      data-slot="account-row"
      data-status={status}
      className={cn(
        'flex flex-col gap-3 rounded-lg border bg-surface p-4',
        status === 'was-protected' ? 'border-danger-border' : 'border-border',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-xs text-muted">{t('components.accountRow.stakeAccount')}</span>
          <AddressText address={account.address} />
        </div>
        <SolAmount lamports={account.lamports} className="text-lg font-semibold" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={status} secondKeyKnown={secondKeyKnown} />
        {date === null ? null : <span className="text-sm text-muted">{t('components.status.until', { date })}</span>}
        <ActivationBadge status={activation} />
      </div>
      {status === 'locked-by-other' ? (
        // The key that holds the lock, to compare with the viewer's wallets (copy, explorer: UX rule 9).
        <div data-slot="lock-holder" className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="text-muted">{t('common.roles.second')}</span>
          <AddressText address={account.lockup.custodian} />
        </div>
      ) : null}
      {hint === null || (status === 'protected' && date === null) ? null : (
        <p className={cn('text-sm', status === 'was-protected' ? 'font-medium text-danger' : 'text-muted')}>{hint}</p>
      )}
      {stakeKeyChanged ? (
        <Alert tone="warning" role="note">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription className="flex flex-col items-start gap-2 text-foreground">
            <p className="font-medium">{t('components.accountRow.stakeKeyChanged')}</p>
            {rescueHref === undefined ? null : (
              <Link href={rescueHref} className="rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover">
                {t('components.accountRow.openRescue')}
              </Link>
            )}
          </AlertDescription>
        </Alert>
      ) : managedByService ? (
        <Alert tone="warning" role="note">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription className="text-foreground">
            <p className="font-medium">{t('status.managedByService')}</p>
            <p>{t('components.accountRow.managedByServiceDetail')}</p>
          </AlertDescription>
        </Alert>
      ) : null}
      {actions === undefined ? null : <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </article>
  );
}

/** Loading state of a row. Decorative; the list announces loading. */
export function AccountRowSkeleton({ className }: { className?: string | undefined }) {
  return (
    <div aria-hidden="true" className={cn('flex flex-col gap-3 rounded-lg border border-border bg-surface p-4', className)}>
      <div className="flex justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-36" />
        </div>
        <Skeleton className="h-7 w-28" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-6 w-28 rounded-full" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
    </div>
  );
}

/** Error state of a row: the account could not be read; its address stays visible and the user can retry. */
export function AccountRowError({
  address,
  detail,
  onRetry,
  className,
}: {
  address: string;
  detail?: string | undefined;
  onRetry?: (() => void) | undefined;
  className?: string | undefined;
}) {
  return (
    <article
      aria-label={t('components.accountRow.label', { address: shortAddress(address) })}
      data-slot="account-row"
      data-status="unknown"
      className={cn('flex flex-col gap-3 rounded-lg border border-border bg-surface p-4', className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-xs text-muted">{t('components.accountRow.stakeAccount')}</span>
          <AddressText address={address} />
        </div>
        <StatusBadge status="unknown" />
      </div>
      <ErrorState
        title={t('components.status.unknownHint')}
        message={t('components.accountRow.loadError')}
        detail={detail}
        onRetry={onRetry}
      />
    </article>
  );
}
