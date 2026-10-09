import { cn } from 'cn';
import { LayersIcon, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '@/i18n';
import { AddressText } from './address-text.tsx';

type EmptyStateProps = {
  icon?: LucideIcon | undefined;
  title: string;
  headingLevel?: 2 | 3 | undefined;
  /** Explanation: why it is empty and what the user can do (UX rule 13). */
  children?: ReactNode;
  /** Next step, e.g. a button to check another address. */
  action?: ReactNode;
  className?: string | undefined;
};

/**
 * A list with nothing in it, explained rather than blank (UX rule 13): a soft panel without a frame, an icon, a title,
 * at most two short lines and one action (DECISIONS.md D112).
 */
export function EmptyState({ icon: Icon = LayersIcon, title, headingLevel = 2, children, action, className }: EmptyStateProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div data-slot="empty-state" className={cn('flex flex-col items-start gap-3 rounded-lg bg-subtle p-6', className)}>
      <span className="flex size-10 items-center justify-center rounded-full bg-primary-soft text-primary">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <Heading className="text-base font-semibold">{title}</Heading>
      {children === undefined ? null : <div className="flex max-w-prose flex-col gap-2 text-sm text-muted">{children}</div>}
      {action === undefined ? null : <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

type NoStakeAccountsProps = {
  /** The address that was checked (main key), shown so the user can spot a wrong paste. */
  address?: string | undefined;
  headingLevel?: 2 | 3 | undefined;
  action?: ReactNode;
  className?: string | undefined;
};

/**
 * No stake accounts for this address: what native stake is, why LSTs and exchange stake are not here, and what
 * Stakeward protects (UX rule 13).
 */
export function NoStakeAccounts({ address, headingLevel, action, className }: NoStakeAccountsProps) {
  return (
    <EmptyState title={t('components.empty.noAccountsTitle')} headingLevel={headingLevel} action={action} className={className}>
      {address === undefined ? null : (
        <p className="flex flex-wrap items-center gap-x-1">
          {t('components.empty.noAccountsFor')}
          <AddressText address={address} />
        </p>
      )}
      <p>{t('components.empty.nativeStake')}</p>
      <p>{t('components.empty.notStake')}</p>
      <p>{t('components.empty.checkMainKey')}</p>
    </EmptyState>
  );
}
