import {
  formatSol,
  formatUtcDate,
  isLockupInForce,
  ZERO_ADDRESS,
  type ClockView,
  type InspectError,
  type Lockup,
  type TransactionAction,
  type TransactionKind,
  type TransactionSummary as InspectedSummary,
  type WalletRole,
} from '@stakeward/core';
import type { Address } from '@solana/kit';
import { cn } from 'cn';
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  CoinsIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { t, type MessageKey } from '@/i18n';
import { AddressText } from './address-text.tsx';
import { ErrorDetails } from './error-state.tsx';
import { RiskNote } from './risk-note.tsx';
import { SolAmount } from './sol-amount.tsx';
import { roleLabel } from './wallet-slot.tsx';

/**
 * What the chain says about the stake account right now (read by the page, never taken from the link or the app's
 * own state). Optional: without it the summary shows only what the bytes do.
 */
export type OnChainContext = {
  lockup: Lockup;
  /** Cluster clock for "is the lock in force"; the local clock when omitted. */
  clock?: ClockView | undefined;
};

type TransactionSummaryProps = {
  /** From core `inspectTransaction(bytes)` on the exact bytes about to be signed (CLAUDE.md section 3). */
  summary: InspectedSummary;
  current?: OnChainContext | undefined;
  /** Addresses the page knows by role (its wallet slots), to name signers the action itself does not name. */
  knownRoles?: Partial<Record<WalletRole, Address>> | undefined;
  headingLevel?: 2 | 3 | undefined;
  className?: string | undefined;
};

type Heading = 'h2' | 'h3' | 'h4';

const CANNOT: Record<TransactionKind, readonly MessageKey[]> = {
  protect: ['common.cannotMoveSol', 'components.tx.cannot.changeOwner'],
  extend: ['common.cannotMoveSol', 'components.tx.cannot.onlyDate'],
  unlock: ['common.cannotMoveSol'],
  withdraw: ['components.tx.cannot.onlyRecipient', 'components.tx.cannot.noKeyChange'],
  deactivate: ['components.tx.cannot.stakeStays', 'components.tx.cannot.noKeyChange'],
  delegate: ['common.cannotMoveSol', 'components.tx.cannot.noKeyChange'],
  rescue: ['components.tx.cannot.rescueNoMove', 'components.tx.cannot.keepsLock'],
  'nonce-setup': ['components.tx.cannot.noStake'],
  'nonce-close': ['components.tx.cannot.noStake'],
};

/** Roles named by the action itself: these win over the page's `knownRoles`. */
function rolesOf(action: TransactionAction, known: Partial<Record<WalletRole, Address>>): Map<Address, WalletRole> {
  const roles = new Map<Address, WalletRole>();
  for (const [role, address] of Object.entries(known) as [WalletRole, Address | undefined][]) {
    if (address !== undefined) roles.set(address, role);
  }
  if ('mainKey' in action) roles.set(action.mainKey, 'main');
  if ('secondKey' in action && action.secondKey !== null) roles.set(action.secondKey, 'second');
  if ('newWallet' in action) roles.set(action.newWallet, 'new');
  return roles;
}

function localClock(): ClockView {
  // Epoch 0: without the cluster clock only the timestamp part of a lock can be judged.
  return { unixTimestamp: BigInt(Math.floor(Date.now() / 1000)), epoch: 0n };
}

function dateText(unixSeconds: bigint): string {
  return formatUtcDate(unixSeconds) ?? unixSeconds.toString();
}

/** The current lock in words: "No lock", "Locked until 12 April 2027", "Lock ended on ...", "Locked until epoch N". */
export function lockText(lockup: Lockup, clock: ClockView): string {
  if (!isLockupInForce(lockup, clock)) {
    return lockup.unixTimestamp > 0n
      ? t('components.tx.lockEnded', { date: dateText(lockup.unixTimestamp) })
      : t('components.tx.noLock');
  }
  if (lockup.unixTimestamp <= clock.unixTimestamp) {
    return t('components.tx.lockByEpoch', { epoch: lockup.epoch.toString() });
  }
  return t('components.tx.lockedUntil', { date: dateText(lockup.unixTimestamp) });
}

/**
 * The signing screen's summary (UX rule 3), built only from the inspector's reading of the bytes: what this
 * transaction does, what was and what becomes (with `current`), who signs (role names, full addresses, who already
 * signed, who pays), the network fee, what it cannot do, the seed phrase line, and how long it stays valid.
 * Warnings come from comparing the bytes with the chain (DECISIONS.md D23): a new second key replacing another,
 * a lock made shorter, a withdrawal to a wallet that does not sign.
 */
export function TransactionSummary({ summary, current, knownRoles = {}, headingLevel = 2, className }: TransactionSummaryProps) {
  const titleId = useId();
  const { action } = summary;
  const roles = rolesOf(action, knownRoles);
  const clock = current?.clock ?? localClock();
  const TitleTag: Heading = headingLevel === 2 ? 'h2' : 'h3';
  const SectionTag: Heading = headingLevel === 2 ? 'h3' : 'h4';
  const changes = changeRows(action, current, clock);
  const warnings = warningsFor(summary, current, clock);

  return (
    <article
      aria-labelledby={titleId}
      data-slot="transaction-summary"
      data-kind={action.kind}
      className={cn('flex flex-col gap-5 rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6', className)}
    >
      <header className="flex flex-col gap-1">
        <TitleTag id={titleId} className="text-xl font-semibold">
          {t(`components.tx.kind.${action.kind}`)}
        </TitleTag>
        <p className="text-sm text-muted">{t('components.tx.intro')}</p>
      </header>

      {'stakeAccount' in action ? (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t('components.tx.stakeAccount')}</span>
          <AddressText address={action.stakeAccount} variant="full" />
        </div>
      ) : null}

      {warnings}

      <Section title={t('components.tx.changes')} tag={SectionTag}>
        <dl className="flex flex-col gap-3">
          {changes.map((row) => (
            <ChangeRow key={row.label} {...row} />
          ))}
        </dl>
      </Section>

      <Section title={t('components.tx.signers')} tag={SectionTag}>
        <ul className="flex flex-col gap-3">
          {summary.requiredSigners.map((signer) => {
            const role = roles.get(signer);
            const signed = summary.presentSignatures.includes(signer);
            return (
              <li key={signer} className="flex flex-col gap-1 rounded-md border border-border p-3" data-signer={role ?? 'other'}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{role === undefined ? t('components.tx.signer') : roleLabel(role)}</span>
                  {signed ? (
                    <Badge tone="success">
                      <CircleCheckIcon aria-hidden="true" />
                      {t('components.tx.signed')}
                    </Badge>
                  ) : (
                    <Badge tone="outline">
                      <CircleDashedIcon aria-hidden="true" />
                      {t('components.tx.notSigned')}
                    </Badge>
                  )}
                  {signer === summary.feePayer ? (
                    <Badge tone="outline">
                      <CoinsIcon aria-hidden="true" />
                      {t('components.tx.paysFee')}
                    </Badge>
                  ) : null}
                </div>
                <AddressText address={signer} variant="full" />
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title={t('common.networkFee')} tag={SectionTag}>
        <p className="text-sm">
          {t('components.tx.feeValue', { amount: formatSol(summary.networkFeeLamports) })}
        </p>
      </Section>

      <Section title={t('components.tx.cannotDo')} tag={SectionTag}>
        <ul className="flex flex-col gap-2 text-sm">
          {CANNOT[action.kind].map((key) => (
            <li key={key} className="flex items-start gap-2">
              <ShieldCheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
              <span>{t(key)}</span>
            </li>
          ))}
          <li className="flex items-start gap-2 font-medium">
            <ShieldCheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            <span>{t('common.neverSeedPhrase')}</span>
          </li>
        </ul>
      </Section>

      <Section title={t('components.tx.lifetime')} tag={SectionTag}>
        {summary.lifetime.kind === 'blockhash' ? (
          <p className="text-sm">{t('components.tx.blockhash')}</p>
        ) : (
          <div className="flex flex-col gap-1 text-sm">
            <p>{t('components.tx.nonce')}</p>
            <AddressText address={summary.lifetime.nonceAccount} variant="full" />
          </div>
        )}
        {summary.lighthouseTail === null ? null : (
          <p className="text-sm text-muted">
            {t('components.tx.lighthouse', { count: summary.lighthouseTail.instructionCount })}
          </p>
        )}
      </Section>
    </article>
  );
}

function Section({ title, tag: Tag, children }: { title: string; tag: Heading; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <Tag className="text-sm font-semibold tracking-wide text-muted uppercase">{title}</Tag>
      {children}
    </section>
  );
}

type Row = { label: string; before?: ReactNode; after: ReactNode };

function ChangeRow({ label, before, after }: Row) {
  return (
    <div className="flex flex-col gap-1 rounded-md bg-subtle p-3">
      <dt className="text-sm font-semibold">{label}</dt>
      {before === undefined ? null : (
        <dd className="flex flex-col gap-0.5 text-sm">
          <span className="text-xs text-muted">{t('components.tx.now')}</span>
          <div className="min-w-0">{before}</div>
        </dd>
      )}
      <dd className="flex flex-col gap-0.5 text-sm">
        <span className="text-xs text-muted">{t('components.tx.after')}</span>
        <div className="min-w-0 font-medium">{after}</div>
      </dd>
    </div>
  );
}

function Full({ address, role }: { address: Address; role?: WalletRole | undefined }) {
  return (
    <span className="flex flex-col">
      {role === undefined ? null : <span>{roleLabel(role)}</span>}
      <AddressText address={address} variant="full" />
    </span>
  );
}

function custodianInForce(current: OnChainContext, clock: ClockView): Address | null {
  const { lockup } = current;
  return isLockupInForce(lockup, clock) && lockup.custodian !== ZERO_ADDRESS ? lockup.custodian : null;
}

function changeRows(action: TransactionAction, current: OnChainContext | undefined, clock: ClockView): Row[] {
  const lockNow = current === undefined ? undefined : lockText(current.lockup, clock);
  const lockLabel = t('components.tx.lock');
  switch (action.kind) {
    case 'protect': {
      const custodian = current === undefined ? undefined : custodianInForce(current, clock);
      return [
        { label: lockLabel, before: lockNow, after: t('components.tx.lockedUntil', { date: dateText(action.lockUntil) }) },
        {
          label: roleLabel('second'),
          before: custodian === undefined ? undefined : custodian === null ? t('components.tx.none') : <Full address={custodian} />,
          after: <Full address={action.secondKey} />,
        },
      ];
    }
    case 'extend':
      return [{ label: lockLabel, before: lockNow, after: t('components.tx.lockedUntil', { date: dateText(action.lockUntil) }) }];
    case 'unlock':
      return [{ label: lockLabel, before: lockNow, after: t('components.tx.noLock') }];
    case 'withdraw':
      return [
        { label: t('components.tx.amount'), after: t('components.tx.leavesStake', { amount: formatSol(action.lamports) }) },
        {
          label: t('components.tx.sentTo'),
          after: <Full address={action.recipient} role={action.recipient === action.mainKey ? 'main' : undefined} />,
        },
      ];
    case 'rescue':
      return [
        {
          label: t('components.tx.controlledBy'),
          before: <Full address={action.mainKey} role="main" />,
          after: <Full address={action.newWallet} role="new" />,
        },
        { label: lockLabel, before: lockNow, after: t('components.tx.lockUnchanged') },
      ];
    case 'deactivate':
      return [{ label: t('components.tx.staking'), before: t('components.tx.delegated'), after: t('components.tx.deactivating') }];
    case 'delegate':
      return [{ label: t('components.tx.validator'), after: <Full address={action.voteAccount} /> }];
    case 'nonce-setup':
      return [
        {
          label: t('components.tx.signingAccount'),
          after: (
            <span className="flex flex-col">
              <span>{t('components.tx.created')}</span>
              <AddressText address={action.nonceAccount} variant="full" />
            </span>
          ),
        },
        {
          label: t('components.tx.deposit'),
          after: t('components.tx.depositNote', { amount: formatSol(action.lamports) }),
        },
      ];
    case 'nonce-close':
      return [
        { label: t('components.tx.signingAccount'), before: <Full address={action.nonceAccount} />, after: t('components.tx.closed') },
        {
          label: t('components.tx.returnedTo'),
          after: (
            <span className="flex flex-col">
              <SolAmount lamports={action.lamports} />
              <AddressText address={action.recipient} variant="full" />
            </span>
          ),
        },
      ];
  }
}

function warningsFor(summary: InspectedSummary, current: OnChainContext | undefined, clock: ClockView): ReactNode {
  const { action } = summary;
  const notes: ReactNode[] = [];
  if (action.kind === 'protect' && current !== undefined) {
    const custodian = custodianInForce(current, clock);
    if (custodian !== null && custodian !== action.secondKey && custodian !== action.mainKey) {
      notes.push(
        <Warning key="replaces" tone="warning" address={custodian}>
          {t('components.tx.warn.replacesSecondKey')}
        </Warning>,
      );
    }
  }
  if (action.kind === 'extend' && current !== undefined && action.lockUntil <= current.lockup.unixTimestamp) {
    notes.push(
      <Warning key="shortens" tone="warning">
        {t('components.tx.warn.shortens', {
          date: dateText(action.lockUntil),
          current: dateText(current.lockup.unixTimestamp),
        })}
      </Warning>,
    );
  }
  if (action.kind === 'unlock') {
    notes.push(<RiskNote key="unlock" risk="unlock-opens-window" tone="danger" />);
  }
  if (action.kind === 'withdraw' && !summary.requiredSigners.includes(action.recipient)) {
    notes.push(
      <Warning key="recipient" tone="danger" address={action.recipient}>
        {t('components.tx.warn.recipientNotSigner')}
      </Warning>,
    );
  }
  return notes.length === 0 ? null : <div className="flex flex-col gap-2">{notes}</div>;
}

function Warning({ tone, address, children }: { tone: 'warning' | 'danger'; address?: Address; children: ReactNode }) {
  return (
    <Alert tone={tone}>
      <TriangleAlertIcon aria-hidden="true" />
      <AlertDescription className="flex flex-col gap-1 text-foreground">
        <p className="font-medium">{children}</p>
        {address === undefined ? null : <AddressText address={address} variant="full" />}
      </AlertDescription>
    </Alert>
  );
}

/** While the bytes are being inspected (async: signatures are checked with Web Crypto). */
export function TransactionSummarySkeleton({ className }: { className?: string | undefined }) {
  return (
    <div
      aria-hidden="true"
      className={cn('flex flex-col gap-5 rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6', className)}
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

/**
 * The inspector refused the bytes: nothing to show, so nothing to sign. Says so plainly, with the reason in words
 * and the inspector's own message under "Details" (UX rule 8).
 */
export function TransactionSummaryError({
  error,
  headingLevel = 2,
  action,
  className,
}: {
  error: InspectError;
  headingLevel?: 2 | 3 | undefined;
  /** The way forward, e.g. "Back to your accounts". */
  action?: ReactNode;
  className?: string | undefined;
}) {
  const TitleTag: Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <Alert tone="danger" data-slot="transaction-summary" data-error={error.code} className={className}>
      <CircleXIcon aria-hidden="true" />
      <TitleTag data-slot="alert-title" className="font-semibold">
        {t('components.tx.rejectedTitle')}
      </TitleTag>
      <AlertDescription className="flex flex-col gap-2 text-foreground">
        <p className="font-medium">{t(`components.tx.rejected.${error.code}`)}</p>
        <p>{t('components.tx.rejectedBody')}</p>
        <ErrorDetails detail={error.message} />
        {action === undefined ? null : <div className="flex flex-wrap gap-2">{action}</div>}
      </AlertDescription>
    </Alert>
  );
}
