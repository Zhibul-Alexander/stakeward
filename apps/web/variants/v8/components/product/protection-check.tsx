import type { Address } from '@solana/kit';
import { formatUtcDate, shortAddress, type SetupCheck, type SetupCheckFinding, type SetupCheckItem } from '@stakeward/core';
import {
  BellIcon,
  CalendarPlusIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleQuestionMarkIcon,
  ListTodoIcon,
  ExternalLinkIcon,
  FileTextIcon,
  InfoIcon,
  LifeBuoyIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { cn } from 'cn';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { t, type MessageKey } from '@/i18n';
import { AddressText } from './address-text.tsx';
import { Disclosure } from './disclosure.tsx';
import { EmptyState } from './empty-state.tsx';
import { ErrorState } from './error-state.tsx';
import { ScoreGauge } from './score-gauge.tsx';

/** Where each check's fix lives (CLAUDE.md section 9 routes); the page passes its own link builders. */
export type ProtectionCheckLinks = {
  protect: (accounts: readonly Address[]) => string;
  extend: (account: Address) => string;
  /** The rescue wizard for this main key. */
  rescue: string;
  /** The one-tap rescue kit wizard (D118). */
  rescueKit: string;
  /** "Get alerts in Telegram": opens the bot in a new tab. */
  telegram: string;
  recovery: (account: Address) => string;
};

export type ProtectionCheckProps =
  | { state: 'loading'; className?: string | undefined }
  | { state: 'error'; message: string; detail?: string | undefined; onRetry?: (() => void) | undefined; className?: string | undefined }
  | { state: 'ready'; result: SetupCheck; links: ProtectionCheckLinks; className?: string | undefined };

type Look = { tone: NonNullable<BadgeProps['tone']>; icon: LucideIcon; label: MessageKey };

const LOOKS: Record<'pass' | 'fail' | 'warning' | 'unknown' | 'not-applicable' | 'info', Look> = {
  pass: { tone: 'success', icon: CircleCheckIcon, label: 'setupCheck.status.pass' },
  fail: { tone: 'warning', icon: ListTodoIcon, label: 'setupCheck.status.fail' },
  warning: { tone: 'warning', icon: TriangleAlertIcon, label: 'setupCheck.status.warning' },
  unknown: { tone: 'outline', icon: CircleQuestionMarkIcon, label: 'setupCheck.status.unknown' },
  'not-applicable': { tone: 'neutral', icon: CircleDashedIcon, label: 'setupCheck.status.notApplicable' },
  info: { tone: 'info', icon: InfoIcon, label: 'setupCheck.status.info' },
};

/** A failed check that is advice rather than a hole in the lock reads Check (warning), not Fix (D125). */
function lookOf(item: SetupCheckItem): Look {
  if (item.status === 'fail' && (item.optional || item.id === 'staker')) return LOOKS.warning;
  return LOOKS[item.status];
}

type CheckTexts = { title: MessageKey; pass?: MessageKey; fail?: MessageKey; unknown?: MessageKey; info?: MessageKey; notApplicable: MessageKey };

const TEXTS: Record<SetupCheckItem['id'], CheckTexts> = {
  locked: {
    title: 'setupCheck.checks.locked.title',
    pass: 'setupCheck.checks.locked.pass',
    fail: 'setupCheck.checks.locked.fail',
    notApplicable: 'setupCheck.checks.locked.notApplicable',
  },
  'not-ending': {
    title: 'setupCheck.checks.notEnding.title',
    pass: 'setupCheck.checks.notEnding.pass',
    fail: 'setupCheck.checks.notEnding.fail',
    notApplicable: 'setupCheck.checks.notEnding.notApplicable',
  },
  'second-key': {
    title: 'setupCheck.checks.secondKey.title',
    pass: 'setupCheck.checks.secondKey.pass',
    fail: 'setupCheck.checks.secondKey.fail',
    unknown: 'setupCheck.checks.secondKey.unknown',
    notApplicable: 'setupCheck.checks.secondKey.notApplicable',
  },
  alerts: {
    title: 'setupCheck.checks.alerts.title',
    pass: 'setupCheck.checks.alerts.pass',
    fail: 'setupCheck.checks.alerts.fail',
    unknown: 'setupCheck.checks.alerts.unknown',
    notApplicable: 'setupCheck.checks.alerts.notApplicable',
  },
  'rescue-kit': {
    title: 'setupCheck.checks.rescueKit.title',
    pass: 'setupCheck.checks.rescueKit.pass',
    fail: 'setupCheck.checks.rescueKit.fail',
    unknown: 'setupCheck.checks.rescueKit.unknown',
    notApplicable: 'setupCheck.checks.rescueKit.notApplicable',
  },
  staker: {
    title: 'setupCheck.checks.staker.title',
    pass: 'setupCheck.checks.staker.pass',
    fail: 'setupCheck.checks.staker.fail',
    notApplicable: 'setupCheck.checks.staker.notApplicable',
  },
  'recovery-card': {
    title: 'setupCheck.checks.recoveryCard.title',
    info: 'setupCheck.checks.recoveryCard.info',
    notApplicable: 'setupCheck.checks.recoveryCard.notApplicable',
  },
};

/** Whether the check's result is in "N of M checks pass" (core `setupCheck`: scored, and passed or failed). */
function countsInScore(item: SetupCheckItem): boolean {
  return item.scored && (item.status === 'pass' || item.status === 'fail');
}

/** The check's title, as the AI question and the list say it. */
export function setupCheckTitle(item: SetupCheckItem): string {
  return t(TEXTS[item.id].title);
}

/** The check's one plain sentence for its result. */
export function setupCheckSentence(item: SetupCheckItem): string {
  const texts = TEXTS[item.id];
  const key =
    item.status === 'pass'
      ? texts.pass
      : item.status === 'fail'
        ? texts.fail
        : item.status === 'unknown'
          ? texts.unknown
          : item.status === 'info'
            ? texts.info
            : texts.notApplicable;
  return t(key ?? texts.notApplicable);
}

/** The status word of a check (Pass, Fix, Check, Unknown, Not applicable, Reminder). */
export function setupCheckStatusLabel(item: SetupCheckItem): string {
  return t(lookOf(item).label);
}

/** Why one account is listed, in plain words; `lockUntil` for a lock that ends soon. */
export function setupCheckReason(finding: SetupCheckFinding, lockUntil?: bigint): string {
  if (finding.reason === 'ends-soon') {
    return t('setupCheck.reasons.ends-soon', { date: lockUntil === undefined ? '' : (formatUtcDate(lockUntil) ?? '') });
  }
  return t(`setupCheck.reasons.${finding.reason}`);
}

/**
 * v8 "Pre-flight checklist": the centrepiece of /app. A score card on the checklist's dark band (the gauge has one
 * segment per scored check; the numeral is passed / scored as a share of 100 and says so), then one big row per check:
 * its number, a tick box, the title, the result by word, colour and icon (UX rule 5), the plain sentence, the accounts
 * behind it and the button that fixes it. Deterministic: core `setupCheck` decides, nothing here guesses.
 */
export function ProtectionCheck(props: ProtectionCheckProps) {
  const ready = props.state === 'ready' ? props.result : undefined;
  const score =
    ready === undefined ? undefined : ready.total === 0 ? t('setupCheck.scoreNone') : t('setupCheck.score', { passed: ready.passed, total: ready.total });
  const tally = ready === undefined ? undefined : tallyOf(ready.items);
  return (
    <section aria-labelledby="protection-check-title" data-slot="section" className={cn('flex flex-col', props.className)}>
      <div data-slot="protection-check" data-state={props.state} className="overflow-hidden rounded-lg border border-border bg-surface shadow-md">
        <div className="grid gap-5 bg-band px-4 py-5 text-on-band sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-8 sm:px-8 sm:py-7">
          <ScoreGauge
            passed={ready?.passed}
            total={ready?.total}
            onBand
            className="w-40 sm:w-48"
          />
          <div className="flex min-w-0 flex-col gap-2">
            <h2 id="protection-check-title" className="text-2xl text-balance">
              {t('setupCheck.title')}
            </h2>
            {score === undefined ? null : <p className="font-mono text-base tabular-nums">{score}</p>}
            <p className="max-w-prose text-sm text-pretty text-band-muted">
              {t('setupCheck.intro')} The score is the scored items done, out of 100. Items that read {t('setupCheck.status.unknown')},{' '}
              {t('setupCheck.status.info')} or {t('setupCheck.notScored')} are left out of it.
            </p>
            {tally === undefined ? null : (
              <ul role="list" className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                {tally.map(([label, count, box]) => (
                  <li key={label} className="flex items-center gap-2">
                    <span aria-hidden="true" className={cn('size-3 rounded-sm', box)} />
                    <span className="font-mono tabular-nums">{count}</span>
                    <span>{label}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        {props.state === 'loading' ? (
          <div aria-busy="true" className="flex flex-col gap-2 p-4 sm:p-6">
            <p role="status" className="sr-only">
              {t('setupCheck.loading')}
            </p>
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : props.state === 'error' ? (
          <div className="p-4 sm:p-6">
            <ErrorState title={t('setupCheck.errorTitle')} message={props.message} detail={props.detail} onRetry={props.onRetry} />
          </div>
        ) : props.result.accountCount === 0 ? (
          <div className="p-4 sm:p-6">
            <EmptyState title={t('setupCheck.emptyTitle')} headingLevel={3}>
              <p>{t('setupCheck.empty')}</p>
            </EmptyState>
          </div>
        ) : (
          <ol role="list" className="flex flex-col divide-y divide-border">
            {props.result.items.map((item, index) => (
              <li key={item.id} data-check={item.id} data-status={item.status}>
                <CheckRow item={item} number={index + 1} links={props.links} lockEnds={props.result.lockEnds} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

/** Done, To do, Check, Can't tell and Reminder, with how many items read each (only those that occur). */
function tallyOf(items: readonly SetupCheckItem[]): [string, number, string][] {
  const order: [Look, string][] = [
    [LOOKS.pass, 'bg-done'],
    [LOOKS.fail, 'bg-todo'],
    [LOOKS.warning, 'border-2 border-todo'],
    [LOOKS.unknown, 'border-2 border-dashed border-band-muted'],
    [LOOKS.info, 'bg-info-border'],
  ];
  return order
    .map(([look, box]): [string, number, string] => [t(look.label), items.filter((item) => lookOf(item) === look).length, box])
    .filter(([, count]) => count > 0);
}

/** The tick box of a row: filled green when done, an empty amber box to do, amber outline to check, dashed unknown. */
const BOX: Record<keyof typeof LOOKS, string> = {
  pass: 'border-done bg-done text-surface',
  fail: 'border-todo bg-surface',
  warning: 'border-todo bg-warning-soft text-warning',
  unknown: 'border-dashed border-border-strong bg-surface text-muted',
  'not-applicable': 'border-border bg-subtle text-muted',
  info: 'border-info-border bg-info-soft text-info',
};

function boxOf(item: SetupCheckItem): keyof typeof LOOKS {
  const look = lookOf(item);
  return (Object.keys(LOOKS) as (keyof typeof LOOKS)[]).find((key) => LOOKS[key] === look) ?? 'unknown';
}

function CheckRow({
  item,
  number,
  links,
  lockEnds,
}: {
  item: SetupCheckItem;
  number: number;
  links: ProtectionCheckLinks;
  lockEnds: Readonly<Partial<Record<Address, bigint>>>;
}) {
  const look = lookOf(item);
  const Icon = look.icon;
  const action = mainAction(item, links);
  const box = boxOf(item);
  const open = item.status === 'fail' || look === LOOKS.warning;
  return (
    <div
      className={cn(
        'grid grid-cols-[1.5rem_auto_minmax(0,1fr)] gap-x-3 px-4 py-4 sm:grid-cols-[2rem_auto_minmax(0,1fr)] sm:gap-x-4 sm:px-8 sm:py-5',
        open ? 'bg-surface' : '',
      )}
    >
      <span className="pt-0.5 font-mono text-sm text-muted tabular-nums">{String(number).padStart(2, '0')}</span>
      <span aria-hidden="true" className={cn('mt-0.5 grid size-6 place-items-center rounded-sm border-2 text-xs leading-none font-semibold', BOX[box])}>
        {box === 'pass' ? '✓' : box === 'warning' ? '!' : box === 'unknown' ? '?' : box === 'info' ? 'i' : box === 'not-applicable' ? '–' : ''}
      </span>
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:flex-nowrap sm:items-end">
          <h3 className={cn('text-base font-semibold text-pretty sm:text-lg', item.status === 'not-applicable' ? 'text-muted' : '')}>{setupCheckTitle(item)}</h3>
          <span aria-hidden="true" className="leader hidden sm:block" />
          <Badge tone={look.tone} size="md" data-status={item.status} className="sm:mb-0.5">
            <Icon aria-hidden="true" />
            {t(look.label)}
          </Badge>
        </div>
        <p className="max-w-prose text-sm text-pretty text-muted">
          {setupCheckSentence(item)}
          {item.optional ? <span> ({t('setupCheck.optional')})</span> : null}
          {countsInScore(item) || item.status === 'not-applicable' ? null : <span> {t('setupCheck.notScored')}.</span>}
        </p>
        {item.findings.length === 0 || !(open || item.status === 'info') ? null : (
          <ul role="list" className="flex flex-col divide-y divide-border rounded-md border border-border bg-background">
            {item.findings.map((finding) => (
              <li key={finding.account} className="flex flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
                <AddressText address={finding.account} />
                <span className="text-pretty">{setupCheckReason(finding, lockEnds[finding.account])}</span>
                {accountAction(item, finding, links)}
              </li>
            ))}
          </ul>
        )}
        {item.findings.length === 0 || open || item.status === 'info' ? null : (
          <Disclosure variant="row" summary={<span className="text-sm text-muted">{item.findings.length === 1 ? '1 stake account' : `${String(item.findings.length)} stake accounts`}</span>}>
            <ul role="list" className="flex flex-col gap-2">
              {item.findings.map((finding) => (
                <li key={finding.account} className="flex flex-col gap-1 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2">
                  <AddressText address={finding.account} />
                  <span className="text-pretty">{setupCheckReason(finding, lockEnds[finding.account])}</span>
                  {accountAction(item, finding, links)}
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
        {action === null ? null : <div className="pt-1">{action}</div>}
      </div>
    </div>
  );
}

const linkClass =
  'inline-flex h-9 w-fit items-center gap-2 rounded-md border border-border-strong bg-surface px-3 text-sm font-medium text-foreground hover:bg-subtle [&>svg]:size-4 [&>svg]:shrink-0';

function ActionLink({ href, icon: Icon, children, label }: { href: string; icon: LucideIcon; children: ReactNode; label?: string | undefined }) {
  return (
    <Link href={href} aria-label={label} className={linkClass}>
      <Icon aria-hidden="true" />
      {children}
    </Link>
  );
}

/** The one link that fixes a failing check, for all its accounts at once; none where a fix is per account or none exists. */
function mainAction(item: SetupCheckItem, links: ProtectionCheckLinks): ReactNode {
  switch (item.id) {
    case 'locked':
      return item.status === 'fail' ? (
        <ActionLink href={links.protect(item.findings.map((f) => f.account))} icon={ShieldCheckIcon}>
          {t('setupCheck.checks.locked.action')}
        </ActionLink>
      ) : null;
    case 'alerts':
      // The bot answers /status for the chat; the site cannot know (D125), so the link stays while unknown too.
      return item.status === 'fail' || item.status === 'unknown' ? (
        <a
          href={links.telegram}
          target="_blank"
          rel="noreferrer"
          aria-label={`${t('setupCheck.checks.alerts.action')} ${t('common.opensInNewTab')}`}
          className={linkClass}
        >
          <BellIcon aria-hidden="true" />
          {t('setupCheck.checks.alerts.action')}
          <ExternalLinkIcon aria-hidden="true" />
        </a>
      ) : null;
    case 'rescue-kit':
      return item.status === 'fail' ? (
        <ActionLink href={links.rescueKit} icon={LifeBuoyIcon}>
          {t('setupCheck.checks.rescueKit.action')}
        </ActionLink>
      ) : null;
    case 'staker':
      return item.findings.some((f) => f.reason === 'staker-changed') ? (
        <ActionLink href={links.rescue} icon={LifeBuoyIcon}>
          {t('setupCheck.checks.staker.action')}
        </ActionLink>
      ) : null;
    default:
      return null;
  }
}

/** A fix that is per account: extend a lock that ends soon, open the recovery card of a lock. */
function accountAction(item: SetupCheckItem, finding: SetupCheckFinding, links: ProtectionCheckLinks): ReactNode {
  const named = (action: string) => t('setupCheck.accountAction', { action, address: shortAddress(finding.account) });
  if (finding.reason === 'ends-soon') {
    const action = t('setupCheck.checks.notEnding.action');
    return (
      <ActionLink href={links.extend(finding.account)} icon={CalendarPlusIcon} label={named(action)}>
        {action}
      </ActionLink>
    );
  }
  if (item.id === 'recovery-card') {
    const action = t('setupCheck.checks.recoveryCard.action');
    return (
      <ActionLink href={links.recovery(finding.account)} icon={FileTextIcon} label={named(action)}>
        {action}
      </ActionLink>
    );
  }
  return null;
}
