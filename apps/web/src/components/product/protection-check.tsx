import type { Address } from '@solana/kit';
import { formatUtcDate, shortAddress, type SetupCheck, type SetupCheckFinding, type SetupCheckItem } from '@stakeward/core';
import {
  BellIcon,
  CalendarPlusIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleQuestionMarkIcon,
  CircleXIcon,
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
import { Section } from '@/components/layout/Section';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { t, type MessageKey } from '@/i18n';
import { AddressText } from './address-text.tsx';
import { Disclosure } from './disclosure.tsx';
import { EmptyState } from './empty-state.tsx';
import { ErrorState } from './error-state.tsx';

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
  fail: { tone: 'danger', icon: CircleXIcon, label: 'setupCheck.status.fail' },
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
 * "Protection check" (DECISIONS.md D125): a fixed checklist with a one-line score, one row per check. Each row says
 * its result by word, colour and icon (UX rule 5); a failing row opens by itself and links the action that fixes it,
 * the others fold away (Disclosure). Deterministic: core `setupCheck` decides, nothing here guesses.
 */
export function ProtectionCheck(props: ProtectionCheckProps) {
  const score =
    props.state === 'ready'
      ? props.result.total === 0
        ? t('setupCheck.scoreNone')
        : t('setupCheck.score', { passed: props.result.passed, total: props.result.total })
      : undefined;
  return (
    <Section
      title={t('setupCheck.title')}
      count={score}
      description={t('setupCheck.intro')}
      className={props.className}
    >
      <div data-slot="protection-check" data-state={props.state}>
        {props.state === 'loading' ? (
          <div aria-busy="true" className="flex flex-col gap-2">
            <p role="status" className="sr-only">
              {t('setupCheck.loading')}
            </p>
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : props.state === 'error' ? (
          <ErrorState title={t('setupCheck.errorTitle')} message={props.message} detail={props.detail} onRetry={props.onRetry} />
        ) : props.result.accountCount === 0 ? (
          <EmptyState title={t('setupCheck.emptyTitle')} headingLevel={3}>
            <p>{t('setupCheck.empty')}</p>
          </EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface px-4">
            {props.result.items.map((item) => (
              <li key={item.id} data-check={item.id} data-status={item.status}>
                <CheckRow item={item} links={props.links} lockEnds={props.result.lockEnds} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

function CheckRow({ item, links, lockEnds }: { item: SetupCheckItem; links: ProtectionCheckLinks; lockEnds: Readonly<Partial<Record<Address, bigint>>> }) {
  const look = lookOf(item);
  const Icon = look.icon;
  const action = mainAction(item, links);
  return (
    <Disclosure
      variant="row"
      defaultOpen={item.status === 'fail'}
      summary={
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <Badge tone={look.tone} data-status={item.status}>
            <Icon aria-hidden="true" />
            {t(look.label)}
          </Badge>
          <span className="min-w-0">{setupCheckTitle(item)}</span>
          {item.optional ? <span className="text-sm font-normal text-muted">{t('setupCheck.optional')}</span> : null}
          {countsInScore(item) || item.status === 'not-applicable' ? null : (
            <span className="text-sm font-normal text-muted">{t('setupCheck.notScored')}</span>
          )}
        </span>
      }
    >
      <p className="max-w-prose text-sm text-pretty text-muted">{setupCheckSentence(item)}</p>
      {item.findings.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {item.findings.map((finding) => (
            <li key={finding.account} className="flex flex-col gap-1 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2">
              <AddressText address={finding.account} />
              <span className="text-pretty">{setupCheckReason(finding, lockEnds[finding.account])}</span>
              {accountAction(item, finding, links)}
            </li>
          ))}
        </ul>
      )}
      {action}
    </Disclosure>
  );
}

const linkClass = 'inline-flex w-fit items-center gap-1 rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover [&>svg]:size-4';

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
