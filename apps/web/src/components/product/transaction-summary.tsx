import {
  actionRoles,
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
  ArrowRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  ClockIcon,
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
import { keepTogether } from './countdown.tsx';
import { Disclosure } from './disclosure.tsx';
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

/** One stake account of a batch: its address, its balance when known and what the chain says about it now. */
export type SummaryBatchAccount = { address: Address; lamports: bigint | null; current?: OnChainContext | undefined };

/**
 * N transactions that differ only in their stake account (core `summariesMatchExceptStakeAccount`), shown as one
 * summary with the list of accounts. The page passes it only when that check holds.
 */
export type SummaryBatch = { accounts: readonly SummaryBatchAccount[]; totalFeeLamports: bigint };

type TransactionSummaryProps = {
  /** From core `inspectTransaction(bytes)` on the exact bytes about to be signed (CLAUDE.md section 3). */
  summary: InspectedSummary;
  /** Ignored with `batch`: each account there carries its own. */
  current?: OnChainContext | undefined;
  /** Addresses the page knows by role (its wallet slots), to name signers the action itself does not name. */
  knownRoles?: Partial<Record<WalletRole, Address>> | undefined;
  /**
   * Several transactions summarised at once: the stake account block becomes the list of accounts (each with its
   * balance and, when their locks differ, its lock now and its own warnings), and the fee line gives the total and the
   * fee per transaction. When every account has the same lock now, "Now" is said once in "What changes".
   */
  batch?: SummaryBatch | undefined;
  /** The line under the title that says the summary is read from the bytes; /cosign leaves it out (default true). */
  intro?: boolean | undefined;
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
  for (const source of [known, actionRoles(action)]) {
    for (const [role, address] of Object.entries(source) as [WalletRole, Address | undefined][]) {
      if (address !== undefined) roles.set(address, role);
    }
  }
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
 * The state every account of a batch shares now (the same lock, read with the same clock), or undefined when they
 * differ or one was not read: then each account says its own.
 */
function sharedCurrent(accounts: readonly SummaryBatchAccount[]): OnChainContext | undefined {
  const [first] = accounts;
  const head = first?.current;
  if (head === undefined) return undefined;
  const same = accounts.every(({ current }) => {
    if (current === undefined) return false;
    const { lockup } = current;
    return (
      lockup.unixTimestamp === head.lockup.unixTimestamp &&
      lockup.epoch === head.lockup.epoch &&
      lockup.custodian === head.lockup.custodian &&
      current.clock?.unixTimestamp === head.clock?.unixTimestamp &&
      current.clock?.epoch === head.clock?.epoch
    );
  });
  return same ? head : undefined;
}

/**
 * The signing screen's summary as a receipt (UX rule 3, DECISIONS.md D112), built only from the inspector's reading of
 * the bytes, top to bottom: what this transaction does; the warnings, never folded (a new second key replacing
 * another, a lock made shorter, a withdrawal to a wallet that does not sign: DECISIONS.md D23); the stake account; what
 * was and what becomes (with `current`); who signs (role names, full addresses, who already signed, who pays); the
 * network fee; what it cannot do with the seed phrase line; and how long it stays valid, with the link-signing account
 * and the wallet's added checks under "Technical details".
 */
export function TransactionSummary({
  summary,
  current: single,
  knownRoles = {},
  batch,
  intro = true,
  headingLevel = 2,
  className,
}: TransactionSummaryProps) {
  const titleId = useId();
  const signersId = useId();
  const { action } = summary;
  const roles = rolesOf(action, knownRoles);
  // A batch says "now" once when its accounts share it; otherwise each account says its own.
  const shared = batch === undefined ? undefined : sharedCurrent(batch.accounts);
  const current = batch === undefined ? single : shared;
  const clock = current?.clock ?? localClock();
  const TitleTag: Heading = headingLevel === 2 ? 'h2' : 'h3';
  const SectionTag: Heading = headingLevel === 2 ? 'h3' : 'h4';
  const changes = changeRows(action, current, clock);
  // When every "Now" is a word or two and an "After" holds an address, the After column takes the room the Now column
  // does not need, so the address wraps less.
  const afterWide =
    changes.every((row) => row.before === undefined || typeof row.before === 'string') &&
    changes.some((row) => typeof row.after !== 'string');
  // The warnings that depend on an account's state go with that account when a batch's accounts differ.
  const warnings = [
    ...(batch === undefined || shared !== undefined ? stateWarnings(action, current, clock) : []),
    ...actionWarnings(summary),
  ];
  const title =
    batch !== undefined && action.kind === 'protect'
      ? t('components.tx.batch.kind.protect', { count: batch.accounts.length })
      : t(`components.tx.kind.${action.kind}`);
  const { lifetime, lighthouseTail } = summary;

  return (
    <article
      aria-labelledby={titleId}
      data-slot="transaction-summary"
      data-kind={action.kind}
      className={cn(
        '@container flex flex-col divide-y divide-border rounded-lg border border-border bg-surface px-4 py-1 text-pretty sm:px-6 sm:py-2',
        '*:py-3 sm:*:py-4',
        className,
      )}
    >
      <header className="flex flex-col gap-1">
        <TitleTag id={titleId} className="text-lg font-semibold">
          {title}
        </TitleTag>
        {intro ? <p className="text-sm text-muted">{t('components.tx.intro')}</p> : null}
      </header>

      {warnings.length === 0 ? null : (
        <div data-slot="summary-warnings" className="flex flex-col gap-2">
          {warnings}
        </div>
      )}

      {batch !== undefined ? (
        <BatchAccounts action={action} accounts={batch.accounts} shared={shared !== undefined} tag={SectionTag} />
      ) : 'stakeAccount' in action ? (
        <Part title={t('components.tx.stakeAccount')} tag={SectionTag}>
          <AddressText address={action.stakeAccount} variant="full" />
        </Part>
      ) : null}

      <Part title={t('components.tx.changes')} tag={SectionTag}>
        <dl className="flex flex-col gap-3">
          {changes.map((row) => (
            <ChangeRow key={row.label} {...row} afterWide={afterWide} />
          ))}
        </dl>
      </Part>

      <section className="flex flex-col gap-2">
        <SectionTag id={signersId} className="text-sm font-semibold text-foreground">
          {t('components.tx.signers')}
        </SectionTag>
        <ul aria-labelledby={signersId} className="flex flex-col divide-y divide-border">
          {summary.requiredSigners.map((signer) => {
            const role = roles.get(signer);
            const signed = summary.presentSignatures.includes(signer);
            return (
              <li key={signer} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0" data-signer={role ?? 'other'}>
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
      </section>

      <section className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <SectionTag className="text-sm font-semibold text-foreground">{t('common.networkFee')}</SectionTag>
        <p className="text-sm tabular-nums">
          {batch === undefined
            ? t('components.tx.feeValue', { amount: formatSol(summary.networkFeeLamports) })
            : t('components.tx.batch.fee', {
                amount: formatSol(summary.networkFeeLamports),
                total: formatSol(batch.totalFeeLamports),
              })}
        </p>
      </section>

      <div className="flex flex-col gap-4">
        <Part title={t('components.tx.cannotDo')} tag={SectionTag}>
          <ul className="flex flex-col gap-2 rounded-md bg-subtle p-3 text-sm">
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
        </Part>
        <div data-slot="summary-lifetime" className="flex flex-col gap-2 text-sm">
          <p className="flex items-start gap-2 text-muted">
            <ClockIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {lifetime.kind === 'blockhash' ? t('components.tx.blockhash') : t('components.tx.nonceLifetime')}
          </p>
          {lifetime.kind === 'blockhash' && lighthouseTail === null ? null : (
            <Disclosure summary={t('components.tx.technical')}>
              <div className="flex flex-col gap-2">
                {lifetime.kind === 'nonce' ? (
                  <div className="flex flex-col">
                    <span className="text-muted">{t('components.tx.signingAccount')}</span>
                    <AddressText address={lifetime.nonceAccount} variant="full" />
                  </div>
                ) : null}
                {lighthouseTail === null ? null : (
                  <p className="text-muted">{t('components.tx.lighthouse', { count: lighthouseTail.instructionCount })}</p>
                )}
              </div>
            </Disclosure>
          )}
        </div>
      </div>
    </article>
  );
}

/** The stake accounts of a batch, each in full with its balance; its lock now and its own warnings when they differ. */
function BatchAccounts({
  action,
  accounts,
  shared,
  tag: Tag,
}: {
  action: TransactionAction;
  accounts: readonly SummaryBatchAccount[];
  /** Every account has the same lock now: "What changes" says it once, the rows do not. */
  shared: boolean;
  tag: Heading;
}) {
  const labelId = useId();
  return (
    <section className="flex flex-col gap-2">
      <Tag id={labelId} className="text-sm font-semibold text-foreground">
        {t('components.tx.batch.accounts', { count: accounts.length })}
      </Tag>
      <ul aria-labelledby={labelId} className="flex flex-col gap-3">
        {accounts.map((account) => {
          const clock = account.current?.clock ?? localClock();
          const warnings = shared ? [] : stateWarnings(action, account.current, clock);
          return (
            <li key={account.address} data-account={account.address} className="flex flex-col gap-1">
              <div className="flex flex-col @md:flex-row @md:items-start @md:gap-4">
                <AddressText address={account.address} variant="full" className="min-w-0 flex-1" />
                {/* A column of one width, right-aligned, so the copy buttons line up whatever the amounts. */}
                {account.lamports === null ? null : (
                  <SolAmount lamports={account.lamports} className="text-sm font-medium @md:min-w-36 @md:py-1.5 @md:text-right" />
                )}
              </div>
              {shared || account.current === undefined ? null : (
                <span className="text-sm text-muted">
                  {t('components.tx.batch.now', { lock: lockText(account.current.lockup, clock) })}
                </span>
              )}
              {warnings.length === 0 ? null : <div className="mt-1 flex flex-col gap-2">{warnings}</div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** One part of the receipt: its heading (UI text, not uppercase) and its content. */
function Part({ title, tag: Tag, children }: { title: string; tag: Heading; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <Tag className="text-sm font-semibold text-foreground">{title}</Tag>
      {children}
    </section>
  );
}

type Row = { label: string; before?: ReactNode; after: ReactNode; note?: string | undefined };

/**
 * One line of "What changes": what, now, after. In a receipt 576 px wide or more (a container query, so a narrow column
 * on a wide screen stacks too) three columns, the After value after an arrow; narrower, stacked, each value with its
 * word in front. The After value sits on a subtle inset: it is what the signature makes true.
 *
 * `afterWide` (every Now is a word or two, an After holds an address): narrow, the label and its Now share one line and
 * the After goes below; from 576 px the label and Now columns are narrow and the After takes the rest, so a full
 * address fits on one line next to its copy button.
 */
function ChangeRow({ label, before, after, note, afterWide }: Row & { afterWide: boolean }) {
  const afterValue = (
    <div className="flex items-baseline gap-2 @xl:flex-col @xl:items-start @xl:gap-0.5">
      <span className="w-10 shrink-0 text-xs text-muted @xl:w-auto">{t('components.tx.after')}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 @xl:w-full">
        <div className="min-w-0 font-medium">{after}</div>
        {note === undefined ? null : <p className="text-xs text-muted">{note}</p>}
      </div>
    </div>
  );
  // The arrow stands in the gap between the columns, so the After value keeps its width.
  const arrow = <ArrowRightIcon aria-hidden="true" className="absolute top-2.5 -left-5 hidden size-4 text-muted @xl:block" />;
  if (afterWide) {
    return (
      <div
        data-layout="wide-after"
        className="grid grid-cols-3 gap-x-3 gap-y-1.5 @xl:flex @xl:flex-row @xl:items-start @xl:gap-0"
      >
        <dt className="col-start-1 row-start-1 text-sm font-semibold @xl:w-20 @xl:shrink-0 @xl:py-2">{label}</dt>
        {before === undefined ? (
          // Keeps the After column in place when there is no Now (an empty dd: a span is not allowed in a dl group).
          <dd aria-hidden="true" className="hidden @xl:ml-3 @xl:block @xl:w-24 @xl:shrink-0" />
        ) : (
          <dd className="col-span-2 col-start-2 row-start-1 flex min-w-0 items-baseline gap-2 text-sm @xl:ml-3 @xl:w-24 @xl:shrink-0 @xl:flex-col @xl:items-start @xl:gap-0.5 @xl:py-2">
            <span className="shrink-0 text-xs text-muted">{t('components.tx.now')}</span>
            <div className="min-w-0 flex-1">{before}</div>
          </dd>
        )}
        <dd className="relative col-span-3 col-start-1 row-start-2 min-w-0 rounded-md bg-subtle px-2 py-1.5 text-sm @xl:ml-6 @xl:flex-1 @xl:py-2">
          {arrow}
          {afterValue}
        </dd>
      </div>
    );
  }
  return (
    <div data-layout="columns" className="flex flex-col gap-1.5 @xl:flex-row @xl:items-start @xl:gap-6">
      <dt className="text-sm font-semibold @xl:w-24 @xl:shrink-0 @xl:py-2">{label}</dt>
      {before === undefined ? (
        // Keeps the After column in place when there is no Now (an empty dd: a span is not allowed in a dl group).
        <dd aria-hidden="true" className="hidden @xl:block @xl:flex-1 @xl:basis-0" />
      ) : (
        <dd className="flex min-w-0 items-baseline gap-2 text-sm @xl:flex-1 @xl:basis-0 @xl:flex-col @xl:items-start @xl:gap-0.5 @xl:py-2">
          <span className="w-10 shrink-0 text-xs text-muted @xl:w-auto">{t('components.tx.now')}</span>
          <div className="min-w-0 flex-1">{before}</div>
        </dd>
      )}
      <dd className="relative min-w-0 rounded-md bg-subtle px-2 py-1.5 text-sm @xl:flex-1 @xl:basis-0 @xl:py-2">
        {arrow}
        {afterValue}
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
          // What a Ledger names the new second key (its sources, not a device: DECISIONS.md D80).
          note: t('components.tx.ledgerNewAuthority'),
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

/** Warnings from comparing the action with the account's state now: a second key replaced, a lock made shorter. */
function stateWarnings(action: TransactionAction, current: OnChainContext | undefined, clock: ClockView): ReactNode[] {
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
  const shortened = shortenedTo(action, current, clock);
  if (shortened !== null && current !== undefined) {
    // Each date on one line: at 360 px "on 1" / "January 2027" would read as two facts.
    notes.push(
      <Warning key="shortens" tone="warning">
        {t('components.tx.warn.shortens', {
          date: keepTogether(dateText(shortened)),
          current: keepTogether(dateText(current.lockup.unixTimestamp)),
        })}
      </Warning>,
    );
  }
  return notes;
}

/**
 * The earlier end this action gives the lock, or null: an extend to a date not after the current end, or a protect over
 * a lock in force by date that ends later (its second key signs a protect, and in force that key may set any end).
 */
function shortenedTo(action: TransactionAction, current: OnChainContext | undefined, clock: ClockView): bigint | null {
  if (current === undefined) return null;
  const end = current.lockup.unixTimestamp;
  if (action.kind === 'extend') return action.lockUntil <= end ? action.lockUntil : null;
  if (action.kind === 'protect') return end > clock.unixTimestamp && action.lockUntil < end ? action.lockUntil : null;
  return null;
}

/** Warnings from the bytes alone: removing the lock early, SOL sent to a wallet that does not sign. */
function actionWarnings(summary: InspectedSummary): ReactNode[] {
  const { action } = summary;
  const notes: ReactNode[] = [];
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
  return notes;
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

/** While the bytes are being inspected (async: signatures are checked with Web Crypto): the receipt's shape. */
export function TransactionSummarySkeleton({ className }: { className?: string | undefined }) {
  return (
    <div
      aria-hidden="true"
      data-slot="transaction-summary-skeleton"
      className={cn('flex flex-col divide-y divide-border rounded-lg border border-border bg-surface px-4 py-1 sm:px-6 sm:py-2', '*:py-4', className)}
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-full" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-16 w-full" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-12 w-full" />
      </div>
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
