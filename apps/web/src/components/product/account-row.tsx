import {
  EXPIRING_THRESHOLD_SECONDS,
  formatUtcDate,
  shortAddress,
  type ActivationStatus,
  type ClockView,
  type ProtectionStatus,
  type StakeAccount,
} from '@stakeward/core';
import { cn } from 'cn';
import {
  ActivityIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CirclePauseIcon,
  ClockIcon,
  RotateCcwIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { t, type MessageKey } from '@/i18n';
import { AddressText } from './address-text.tsx';
import { ErrorDetails } from './error-state.tsx';
import { SolAmount } from './sol-amount.tsx';
import { StatusBadge, type StatusBadgeStatus } from './status-badge.tsx';

const ACTIVATION_ICON: Record<ActivationStatus, LucideIcon> = {
  active: ActivityIcon,
  activating: TrendingUpIcon,
  deactivating: TrendingDownIcon,
  inactive: CirclePauseIcon,
};

/**
 * Staking state by epochs (core `stakeActivationStatus`): muted word and icon. It is not a risk, so it is text next to
 * the status badge, never a second badge.
 */
export function ActivationText({ status, className }: { status: ActivationStatus; className?: string | undefined }) {
  const Icon = ACTIVATION_ICON[status];
  return (
    <span data-activation={status} className={cn('inline-flex items-center gap-1 text-sm text-muted', className)}>
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {t(`components.activation.${status}`)}
    </span>
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
  /**
   * This browser knows a second key for the account's main key: the list core `scannerStatus` got was not empty. With
   * one, a `locked-by-other` lock is held by none of them and reads Locked by another key, with no "connect it" (what a
   * fake site leaves, D35); without, Locked by a second key, which on a new device is the viewer's own lock too.
   */
  secondKeyKnown: boolean;
  /** F6: this account was protected and its lock is gone. With `protection: 'unprotected'` its badge is red. */
  wasProtected?: boolean | undefined;
  /** Rescue for this account's main key (`/rescue?address=`): linked from the stake-key warning. Left out on the rescue pages. */
  rescueHref?: string | undefined;
  /**
   * The cluster clock the statuses were computed with. A lock that ends within 30 days of it (core's Expiring
   * threshold) shows its date in warning with a clock icon, whoever holds it: a lock of a key this browser does not
   * know has no Expiring status of its own (DECISIONS.md D109).
   */
  clock: ClockView;
  /**
   * The one visible button: `<Button variant="outline" size="sm">`, primary only when it is the screen's one filled
   * button (DECISIONS.md D109); never danger.
   */
  action?: ReactNode;
  /** Every other action (Withdraw, Recovery card, ...): behind the row's More, which opens them under the row. */
  moreActions?: ReactNode;
  /** More starts open (the /dev/ui sample of an open row). */
  defaultMoreOpen?: boolean | undefined;
  /** A selection checkbox at the start of the row, named by `label`. */
  select?:
    | { checked: boolean; onCheckedChange: (checked: boolean) => void; label: string; disabled?: boolean | undefined }
    | undefined;
  /**
   * More muted facts on the second line. An address in it is always an AddressText (copy and explorer), e.g. "Main key"
   * and its address for the rows of "You are the second key for".
   */
  meta?: ReactNode;
  /** The status hint sentence under the row; default true. A list that says it once for its group passes false. */
  hint?: boolean | undefined;
  /** The second sentence of the staking-service warning, what a lock may do to the service; default false. */
  serviceDetail?: boolean | undefined;
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

/** One warning line of a row: the tone's icon and text, no frame (the row stays one compact block). */
function RowWarning({ children }: { children: ReactNode }) {
  return (
    <div
      role="note"
      data-slot="row-warning"
      data-tone="warning"
      className="flex w-full items-start gap-2 text-sm text-pretty text-foreground sm:col-span-full"
    >
      <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="flex min-w-0 flex-col gap-0.5">{children}</div>
    </div>
  );
}

/**
 * One stake account as a compact row (DECISIONS.md D109), usually inside an AccountList:
 * - line 1: [checkbox] status badge, short address (copy, explorer), then SOL, the action and More at its end. From
 *   640 px the row is a grid of four columns (grid-cols-account-row); in an AccountList the rows share the list's
 *   columns, so SOL stands in one column whichever rows have an action or More. Below 640 px the badge and address keep
 *   line 1 to themselves, and SOL with the action and More take the next line;
 * - then, muted: the lock end date (warning with a clock icon when it ends within 30 days), the staking state, for a
 *   lock of an unknown key the key that holds it (D35), then the caller's meta;
 * - always visible, one line each: the warning that another stake key works under the viewer's own lock (with Rescue,
 *   SECURITY-CHECK П6), or that a staking service may manage the stake;
 * - the status hint, unless the list says it once for its group;
 * - More opens the other actions under the row.
 * The DOM order is the visual order at every width (no CSS `order`), so Tab follows what is on screen (WCAG 2.4.3).
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
  clock,
  action,
  moreActions,
  defaultMoreOpen = false,
  select,
  meta,
  hint = true,
  serviceDetail = false,
  className,
}: AccountRowProps) {
  const [moreOpen, setMoreOpen] = useState(defaultMoreOpen);
  const lockInForce = protection !== 'unprotected';
  const status: StatusBadgeStatus = protection === 'unprotected' && wasProtected ? 'was-protected' : protection;
  // The end date only for a lock its timestamp alone holds (epoch 0, as Stakeward sets it): a lock with an epoch can
  // last past its timestamp, so its date would be wrong or already past.
  const date =
    lockInForce && account.lockup.epoch === 0n && account.lockup.unixTimestamp > 0n
      ? formatUtcDate(account.lockup.unixTimestamp)
      : null;
  const endsSoon =
    date !== null && (status === 'expiring' || account.lockup.unixTimestamp - clock.unixTimestamp < EXPIRING_THRESHOLD_SECONDS);
  const short = shortAddress(account.address);
  const hintKey = status === 'locked-by-other' && secondKeyKnown ? 'status.lockedByAnotherHint' : HINTS[status];
  const hintText = hintKey === null || (status === 'protected' && date === null) ? null : t(hintKey, { date: date ?? '' });
  // Another stake key under the viewer's own lock (SECURITY-CHECK П6): a thief with the main key can still stop or move
  // the stake, and this is what it looks like.
  const stakeKeyChanged = managedByService && (status === 'protected' || status === 'expiring');
  const hasActions = action !== undefined || moreActions !== undefined;

  const body = (
    <>
      <div data-slot="row-head" className="flex w-full min-w-0 flex-auto flex-wrap items-center gap-x-1.5 gap-y-1 sm:w-auto">
        {select === undefined ? null : (
          <Checkbox
            aria-label={select.label}
            checked={select.checked}
            disabled={select.disabled}
            onCheckedChange={(value) => {
              select.onCheckedChange(value === true);
            }}
          />
        )}
        <StatusBadge status={status} secondKeyKnown={secondKeyKnown} size="sm" />
        <AddressText address={account.address} />
      </div>
      {/* From 640 px its line box is as tall as the address's icon buttons, so its text stays centred on the
          bottom-aligned line. */}
      <SolAmount
        lamports={account.lamports}
        className="shrink-0 text-base font-semibold sm:col-start-2 sm:ml-3 sm:justify-self-end sm:text-lg sm:leading-8"
      />
      {hasActions ? (
        // From 640 px its parts take the grid's last two columns (display: contents), in the same order.
        <div data-slot="row-actions" className="ml-auto flex shrink-0 items-center gap-2 sm:contents">
          {action === undefined ? null : (
            <div data-slot="row-action" className="flex sm:col-start-3 sm:ml-3">
              {action}
            </div>
          )}
          {moreActions === undefined ? null : (
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t('app.actions.more', { address: short })} className="sm:col-start-4 sm:ml-2">
                <ChevronDownIcon aria-hidden="true" className={cn('transition-transform', moreOpen && 'rotate-180')} />
              </Button>
            </CollapsibleTrigger>
          )}
        </div>
      ) : null}
      <div data-slot="row-meta" className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted sm:col-span-full">
        {date === null ? null : (
          <span data-slot="lock-end" className={cn('inline-flex items-center gap-1', endsSoon && 'text-warning')}>
            {endsSoon ? <ClockIcon aria-hidden="true" className="size-3.5 shrink-0" /> : null}
            {t('components.status.until', { date })}
          </span>
        )}
        <ActivationText status={activation} />
        {status === 'locked-by-other' ? (
          // The key that holds the lock, to compare with the viewer's wallets (copy, explorer: UX rule 9).
          <span data-slot="lock-holder" className="inline-flex flex-wrap items-center gap-x-1">
            <span>{t('common.roles.second')}</span>
            <AddressText address={account.lockup.custodian} />
          </span>
        ) : null}
        {meta}
      </div>
      {stakeKeyChanged ? (
        <RowWarning>
          <p>
            <span className="font-medium">{t('components.accountRow.stakeKeyChanged')}</span>
            {rescueHref === undefined ? null : (
              <>
                {' '}
                <Link
                  href={rescueHref}
                  className="rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
                >
                  {t('components.accountRow.openRescue')}
                </Link>
              </>
            )}
          </p>
        </RowWarning>
      ) : managedByService ? (
        <RowWarning>
          <p className="font-medium">{t('status.managedByService')}</p>
          {serviceDetail ? <p>{t('components.accountRow.managedByServiceDetail')}</p> : null}
        </RowWarning>
      ) : null}
      {!hint || hintText === null ? null : <p className="w-full text-sm text-muted sm:col-span-full">{hintText}</p>}
      {moreActions === undefined ? null : (
        <CollapsibleContent className="mt-1 flex w-full flex-wrap items-center gap-2 rounded-md bg-subtle p-3 sm:col-span-full">
          {moreActions}
        </CollapsibleContent>
      )}
    </>
  );

  const article = (
    <article
      aria-label={t('components.accountRow.label', { address: short })}
      data-slot="account-row"
      data-status={status}
      // Grid cells sit at the bottom of their line: where a narrow list wraps the address under the badge, SOL, the
      // action and More stay on the address line, so the row still reads (and tabs) left to right, then down.
      className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 sm:grid sm:grid-cols-account-row sm:items-end sm:gap-x-0', className)}
    >
      {body}
    </article>
  );
  if (moreActions === undefined) return article;
  return (
    <Collapsible asChild open={moreOpen} onOpenChange={setMoreOpen}>
      {article}
    </Collapsible>
  );
}

type AccountListProps = {
  /** The list's accessible name. */
  label: string;
  /** An <ol> where the order means something (rescue: what moves first). */
  ordered?: boolean | undefined;
  children: ReactNode;
  className?: string | undefined;
};

/**
 * Rows of stake accounts in one panel, divided by hairlines instead of a card per account (DECISIONS.md D109). Items
 * are AccountListItem. role="list" keeps the list in the accessibility tree where list-style: none drops it (Safari).
 * From 640 px the list holds the rows' four columns and every item and its AccountRow share them (subgrid): a column
 * is as wide as its widest cell in the list, so the SOL of all rows lines up even where a row has no action or More,
 * and a column no row uses takes no room. Anything else in an item spans the whole row.
 */
export function AccountList({ label, ordered = false, children, className }: AccountListProps) {
  const List = ordered ? 'ol' : 'ul';
  return (
    <List
      role="list"
      aria-label={label}
      data-slot="account-list"
      className={cn(
        'divide-y divide-border rounded-lg border border-border bg-surface',
        'sm:grid sm:grid-cols-account-row sm:[&>li]:col-span-full sm:[&>li]:grid sm:[&>li]:grid-cols-subgrid sm:[&>li>*]:col-span-full',
        'sm:[&>li>[data-slot=account-row]]:grid-cols-subgrid',
        className,
      )}
    >
      {children}
    </List>
  );
}

export function AccountListItem({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return <li className={cn('px-4 py-3', className)}>{children}</li>;
}

/** A row standing alone, outside a list (an account page, a result): the list's frame around one row. */
export const SINGLE_ROW_FRAME = 'rounded-lg border border-border bg-surface px-4 py-3';

/** Loading state of a row, the row's own shape. Decorative; the list announces loading. */
export function AccountRowSkeleton({ className }: { className?: string | undefined }) {
  return (
    <div aria-hidden="true" data-slot="account-row-skeleton" className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-24 rounded-full" />
        <Skeleton className="h-5 w-28" />
        <Skeleton className="ml-auto h-6 w-20" />
      </div>
      <Skeleton className="h-4 w-40" />
    </div>
  );
}

/** Loading state of an AccountList: its frame with `rows` row skeletons. Decorative. */
export function AccountListSkeleton({ rows = 2, className }: { rows?: number | undefined; className?: string | undefined }) {
  return (
    <div aria-hidden="true" className={cn('divide-y divide-border rounded-lg border border-border bg-surface', className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="px-4 py-3">
          <AccountRowSkeleton />
        </div>
      ))}
    </div>
  );
}

/** Error state of a row, one line: the account could not be read; its address stays visible and the user can retry. */
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
      className={cn('flex flex-col gap-1', className)}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-danger">
          <CircleAlertIcon aria-hidden="true" className="size-4 shrink-0" />
          {t('components.accountRow.loadError')}
        </span>
        <AddressText address={address} />
        {onRetry === undefined ? null : (
          <Button variant="outline" size="sm" onClick={onRetry} className="sm:ml-auto">
            <RotateCcwIcon aria-hidden="true" />
            {t('common.tryAgain')}
          </Button>
        )}
      </div>
      {detail === undefined ? null : <ErrorDetails detail={detail} />}
    </article>
  );
}
