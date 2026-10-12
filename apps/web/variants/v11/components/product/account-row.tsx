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

/** Staking state by epochs: a muted word and icon; an inactive stake also says "Not earning" in warning (D134). */
export function ActivationText({ status, className }: { status: ActivationStatus; className?: string | undefined }) {
  const Icon = ACTIVATION_ICON[status];
  return (
    <span data-activation={status} className={cn('inline-flex flex-wrap items-center gap-x-1 text-sm', className)}>
      <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
      <span>
        {t(`components.activation.${status}`)}
        {status === 'inactive' ? (
          <span data-slot="not-earning" className="font-medium text-warning">
            {`, ${t('components.activation.notEarning').toLowerCase()}`}
          </span>
        ) : null}
      </span>
    </span>
  );
}

type AccountRowProps = {
  account: Pick<StakeAccount, 'address' | 'lamports' | 'lockup'>;
  activation: ActivationStatus;
  protection: ProtectionStatus;
  managedByService: boolean;
  secondKeyKnown: boolean;
  wasProtected?: boolean | undefined;
  rescueHref?: string | undefined;
  clock: ClockView;
  action?: ReactNode;
  moreActions?: ReactNode;
  defaultMoreOpen?: boolean | undefined;
  select?:
    | { checked: boolean; onCheckedChange: (checked: boolean) => void; label: string; disabled?: boolean | undefined }
    | undefined;
  meta?: ReactNode;
  hint?: boolean | undefined;
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

/** One warning line inside a record: icon and words, no frame. */
function RowWarning({ children }: { children: ReactNode }) {
  return (
    <div role="note" data-slot="row-warning" data-tone="warning" className="flex w-full items-start gap-2 text-sm text-pretty text-foreground">
      <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="flex min-w-0 flex-col gap-0.5">{children}</div>
    </div>
  );
}

/** A fact of the record that decides safety: label above, value large. */
function Fact({ label, children, slot }: { label: string; children: ReactNode; slot?: string | undefined }) {
  return (
    <div data-slot={slot} className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted sm:text-sm">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-x-2">{children}</dd>
    </div>
  );
}

/** A quiet field: small label above a small value. */
function Field({ label, children, slot }: { label: string; children: ReactNode; slot?: string | undefined }) {
  return (
    <div data-slot={slot} className="flex min-w-0 flex-col">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="flex min-h-8 min-w-0 flex-wrap items-center gap-x-2 text-sm">{children}</dd>
    </div>
  );
}

/**
 * v11 "Specimen": one stake account as its record. The head holds the status stamp and the SOL in the record serif;
 * below, labelled fields read like the account itself: the account, who must sign a withdrawal, until when, which
 * key holds the lock, the staking state. Then warnings, the hint, and the actions. Props and behaviour are the base
 * AccountRow's; the DOM order is the visual order (Tab follows the screen).
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
  const date =
    lockInForce && account.lockup.epoch === 0n && account.lockup.unixTimestamp > 0n
      ? formatUtcDate(account.lockup.unixTimestamp)
      : null;
  const endsSoon =
    date !== null && (status === 'expiring' || account.lockup.unixTimestamp - clock.unixTimestamp < EXPIRING_THRESHOLD_SECONDS);
  const short = shortAddress(account.address);
  const hintKey = status === 'locked-by-other' && secondKeyKnown ? 'status.lockedByAnotherHint' : HINTS[status];
  const hintText = hintKey === null || (status === 'protected' && date === null) ? null : t(hintKey, { date: date ?? '' });
  const stakeKeyChanged = managedByService && (status === 'protected' || status === 'expiring');
  const hasActions = action !== undefined || moreActions !== undefined;
  const main = t('common.roles.main');
  const second = t('common.roles.second');

  const body = (
    <>
      <div data-slot="row-head" className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
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
          <StatusBadge status={status} secondKeyKnown={secondKeyKnown} size="md" />
        </div>
        <SolAmount lamports={account.lamports} className="font-serif text-2xl font-medium tracking-tight" />
      </div>
      <dl data-slot="row-facts" className="grid w-full gap-x-8 gap-y-3 border-t border-border pt-3 min-[30rem]:grid-cols-2 sm:grid-cols-3">
        <Fact label="Withdrawal needs" slot="withdraw-needs">
          <span className="text-base font-semibold">{lockInForce ? `${main} and ${second.toLowerCase()}` : `${main} alone`}</span>
        </Fact>
        <Fact label="Locked until" slot="lock-end">
          {date === null ? (
            <span className="text-base text-muted">{lockInForce ? 'Lock in force, no end date' : 'No lock'}</span>
          ) : (
            <span className={cn('inline-flex items-center gap-1.5 font-serif text-xl leading-7 font-medium', endsSoon && 'text-warning')}>
              {endsSoon ? <ClockIcon aria-hidden="true" className="size-4 shrink-0" /> : null}
              {date}
            </span>
          )}
        </Fact>
      </dl>
      <dl data-slot="row-meta" className="grid w-full gap-x-8 gap-y-1 min-[30rem]:grid-cols-2 sm:grid-cols-3">
        <Field label="Stake account">
          <AddressText address={account.address} />
        </Field>
        {lockInForce ? (
          <Field label={second} slot="lock-holder">
            <AddressText address={account.lockup.custodian} />
          </Field>
        ) : null}
        <Field label="Staking">
          <ActivationText status={activation} />
        </Field>
      </dl>
      {meta === undefined || meta === null ? null : (
        <div data-slot="row-extra" className="flex flex-wrap items-center gap-x-3 text-sm text-muted">
          {meta}
        </div>
      )}
      {stakeKeyChanged ? (
        <RowWarning>
          <p>
            <span className="font-medium">{t('components.accountRow.stakeKeyChanged')}</span>
            {rescueHref === undefined ? null : (
              <>
                {' '}
                <Link href={rescueHref} className="rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover">
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
      {!hint || hintText === null ? null : <p className="w-full text-sm text-pretty text-muted">{hintText}</p>}
      {hasActions ? (
        <div data-slot="row-actions" className="flex w-full flex-wrap items-center gap-2 border-t border-dashed border-border pt-3">
          {action === undefined ? null : (
            <div data-slot="row-action" className="flex">
              {action}
            </div>
          )}
          {moreActions === undefined ? null : (
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" aria-label={t('app.actions.more', { address: short })} className="ml-auto text-muted">
                More
                <ChevronDownIcon aria-hidden="true" className={cn('transition-transform', moreOpen && 'rotate-180')} />
              </Button>
            </CollapsibleTrigger>
          )}
        </div>
      ) : null}
      {moreActions === undefined ? null : (
        <CollapsibleContent className="flex w-full flex-wrap items-center gap-2 rounded-md bg-subtle p-3">{moreActions}</CollapsibleContent>
      )}
    </>
  );

  const article = (
    <article
      aria-label={t('components.accountRow.label', { address: short })}
      data-slot="account-row"
      data-status={status}
      className={cn('flex flex-col gap-3', className)}
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
  label: string;
  ordered?: boolean | undefined;
  /** Kept for the base API; records stack, so no shared columns are needed. */
  actionColumns?: boolean | undefined;
  children: ReactNode;
  className?: string | undefined;
};

/** Records stacked with space between them: each account reads as one object. role="list" for Safari. */
export function AccountList({ label, ordered = false, children, className }: AccountListProps) {
  const List = ordered ? 'ol' : 'ul';
  return (
    <List role="list" aria-label={label} data-slot="account-list" className={cn('flex flex-col gap-3', className)}>
      {children}
    </List>
  );
}

/** The record's frame: paper, a hairline, a slightly heavier top rule like a filed card. */
const RECORD_FRAME = 'rounded-record border border-border border-t-foreground/70 border-t-2 bg-surface px-4 py-4 sm:px-5';

export function AccountListItem({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return <li className={cn(RECORD_FRAME, className)}>{children}</li>;
}

/** A record standing alone, outside a list. */
export const SINGLE_ROW_FRAME = RECORD_FRAME;

export function AccountRowSkeleton({ className }: { className?: string | undefined }) {
  return (
    <div aria-hidden="true" data-slot="account-row-skeleton" className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-5 w-24 rounded-sm" />
        <Skeleton className="h-7 w-28" />
      </div>
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <Skeleton className="h-4 w-56 max-w-full" />
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-4 w-48" />
      </div>
    </div>
  );
}

export function AccountListSkeleton({ rows = 2, className }: { rows?: number | undefined; className?: string | undefined }) {
  return (
    <div aria-hidden="true" className={cn('flex flex-col gap-3', className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={RECORD_FRAME}>
          <AccountRowSkeleton />
        </div>
      ))}
    </div>
  );
}

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
