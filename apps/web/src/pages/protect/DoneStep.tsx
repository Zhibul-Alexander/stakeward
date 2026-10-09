import type { Address } from '@solana/kit';
import { formatUtcDate, scannerStatus, stakeActivationStatus, type ClockView, type StakeAccount } from '@stakeward/core';
import { cn } from 'cn';
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
  ClockIcon,
  FileTextIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  SearchIcon,
  SendIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useId, type ReactNode, type Ref } from 'react';
import { Link } from 'wouter';
import { AccountList, AccountListItem, AccountRow } from '@/components/product/account-row';
import { AddressText } from '@/components/product/address-text';
import { ErrorDetails } from '@/components/product/error-state';
import { JobStatusList, type JobStatusItem } from '@/components/product/job-status-list';
import { Button } from '@/components/ui/button';
import { telegramLinkPath } from '@/api/telegram';
import type { WatchState } from '@/api/watch';
import { t } from '@/i18n';
import type { SigningTestOptions } from '@/signing/create';
import { isLinkOpen, isRetryable, retryableOutcomes } from '@/pages/account/check';
import { appLinks } from '@/pages/app/view';
import type { JobView } from '@/signing/machine';
import { NonceCloseCard } from '@/signing/NonceCloseCard';
import { defaultJobReason, jobStatus } from '@/signing/view';
import { refusalText } from './plan.ts';
import type { WizardState } from './wizard.ts';

export type ProtectDoneActions = {
  /** A new run for the accounts known not to have landed. */
  retry: () => void;
  /** Back to the lock period step (a refusal said the lock end is too close). */
  choosePeriod: () => void;
  /** Read the uncertain ones again. */
  checkAgain: () => void;
  /** POST /api/watch again for every protected account. */
  retryMonitoring: () => void;
};

export type ProtectDoneViewProps = {
  headingRef?: Ref<HTMLHeadingElement> | undefined;
  /** Every account of the wizard's runs, in the order they were first signed, with its last outcome. */
  outcomes: readonly JobView[];
  /** The cluster clock of the last run (statuses are computed with it). */
  clock: ClockView;
  mainKey: Address;
  /** The second key that holds the new locks; null when none is known. */
  secondKey: Address | null;
  lockUntil: bigint | null;
  watch: WatchState;
  /** "Get alerts in Telegram" (the worker's redirect to the bot, api/telegram.ts). */
  telegramUrl: string;
  /** Check again is reading the chain. */
  checking?: boolean | undefined;
  /** The last Check again could not read the chain. */
  checkFailed?: boolean | undefined;
  /** After signing by link: the card that closes the main key's link-signing account (shown while it is there). */
  nonceClose?: ReactNode;
  actions: ProtectDoneActions;
};

/** Statuses need a clock; a finished run always carries one, this only keeps the type honest. */
const NO_CLOCK: ClockView = { unixTimestamp: 0n, epoch: 0n };

/** The Done step of the wizard: its outcomes in order, the second key the chain shows, Telegram for the main key. */
export function DoneStep({
  state,
  mainKey,
  secondKeySlot,
  byLink,
  signing,
  ...rest
}: Pick<ProtectDoneViewProps, 'headingRef' | 'watch' | 'checking' | 'checkFailed' | 'actions'> & {
  state: WizardState;
  mainKey: Address;
  /** The run's second key (its slot's, or the typed one by link), used when no protected account names it. */
  secondKeySlot: Address | null;
  /** The run went by link: its link-signing account can be closed here (step 7 spec 10.1). */
  byLink: boolean;
  signing?: SigningTestOptions | undefined;
}) {
  const outcomes = state.order.flatMap((id) => state.outcomes[id] ?? []);
  const secondKey = outcomes.map((job) => protectedAccountOf(job)?.lockup.custodian).find((key) => key !== undefined) ?? secondKeySlot;
  return (
    <ProtectDoneView
      {...rest}
      outcomes={outcomes}
      clock={state.clock ?? NO_CLOCK}
      mainKey={mainKey}
      secondKey={secondKey}
      lockUntil={state.lockUntil}
      telegramUrl={telegramLinkPath(mainKey)}
      nonceClose={byLink ? <NonceCloseCard authority={mainKey} role="main" signing={signing} /> : undefined}
    />
  );
}

/** A link that opens in a new tab shares neither this page (window.opener) nor its address (Referer). */
const NEW_TAB_REL = 'noopener noreferrer';

/**
 * The Done screen of the protect wizard (F1 step 7), presentational so /dev/ui can show it with fixtures (DECISIONS.md
 * D109): the result as the headline with the lock end and the second key, monitoring in one line, what the chain now
 * shows protected (each with its transaction), what is not protected yet with the one way forward for it, then the
 * next steps: Telegram alerts (only the bot reminds before the lock ends) and the recovery card.
 */
export function ProtectDoneView({
  headingRef,
  outcomes,
  clock,
  mainKey,
  secondKey,
  lockUntil,
  watch,
  telegramUrl,
  checking = false,
  checkFailed = false,
  nonceClose,
  actions,
}: ProtectDoneViewProps) {
  const headingId = useId();
  const protectedJobs = outcomes.flatMap((job) => {
    const after = protectedAccountOf(job);
    return after === undefined ? [] : [{ job, after }];
  });
  const [firstProtected] = protectedJobs;
  const others = outcomes.filter((job) => protectedAccountOf(job) === undefined);
  const total = outcomes.length;
  const done = protectedJobs.length;
  const allDone = done > 0 && others.length === 0;
  const title =
    done === 0
      ? t('protect.done.titleNone')
      : done < total
        ? t('protect.done.titlePartial', { done, total })
        : done === 1
          ? t('protect.done.titleOne')
          : t('protect.done.titleOther', { count: done });
  const retryable = retryableOutcomes(others);
  // A link still open holds back Try again for the rest (retryableOutcomes): say why.
  const waitsForLink = others.some(isLinkOpen) && others.some(isRetryable);
  const uncertain = others.filter((job) => job.state.kind === 'unknown');
  const lockEndPassed = others.some((job) => job.state.kind === 'refused' && job.state.reason === 'lock-end-passed');
  const lockDate = lockUntil === null ? null : formatUtcDate(lockUntil);
  const HeadIcon = allDone ? CircleCheckIcon : TriangleAlertIcon;

  return (
    <section aria-labelledby={headingId} data-slot="protect-done" className="flex flex-col gap-6 sm:gap-8">
      <div data-slot="done-header" className="flex flex-col gap-2">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="flex items-start gap-3 text-2xl">
          <HeadIcon aria-hidden="true" className={cn('mt-1 size-6 shrink-0', allDone ? 'text-success' : 'text-warning')} />
          <span>{title}</span>
        </h2>
        {done === 0 || lockDate === null || secondKey === null ? null : (
          <DoneSubtitle date={lockDate} secondKey={secondKey} />
        )}
        {watch.kind === 'idle' ? null : <MonitoringLine watch={watch} onRetry={actions.retryMonitoring} />}
      </div>

      {protectedJobs.length === 0 ? null : (
        // Everything protected: the headline says so, so the list's heading is for screen readers only.
        <List title={t('protect.done.protectedList')} hidden={others.length === 0}>
          <AccountList label={t('protect.done.protectedList')}>
            {protectedJobs.map(({ job, after }) => (
              <AccountListItem key={job.id}>
                <ProtectedRow job={job} after={after} clock={clock} secondKey={secondKey} />
              </AccountListItem>
            ))}
          </AccountList>
        </List>
      )}

      {others.length === 0 ? null : (
        <List title={t('protect.done.notProtectedList')}>
          <JobStatusList items={others.map(notProtectedItem)} label={t('protect.done.notProtectedList')} />
          {checkFailed ? (
            <p role="status" className="flex items-start gap-2 text-sm font-medium text-danger">
              <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
              {t('protect.done.checkFailed')}
            </p>
          ) : null}
          {waitsForLink ? <p className="max-w-prose text-sm">{t('components.jobs.retryAfterLink')}</p> : null}
          {retryable.length === 0 && uncertain.length === 0 && !lockEndPassed ? null : (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {retryable.length === 0 ? null : (
                <Button onClick={actions.retry} className="h-auto min-h-10 max-w-full whitespace-normal">
                  <RotateCcwIcon aria-hidden="true" />
                  {retryable.length === 1 ? t('protect.done.retryOne') : t('protect.done.retryOther', { count: retryable.length })}
                </Button>
              )}
              {lockEndPassed ? (
                <Button variant="outline" onClick={actions.choosePeriod} className="h-auto min-h-10 max-w-full whitespace-normal">
                  {t('protect.done.choosePeriod')}
                </Button>
              ) : null}
              {uncertain.length === 0 ? null : (
                <Button variant="outline" onClick={actions.checkAgain} disabled={checking}>
                  {checking ? (
                    <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
                  ) : (
                    <SearchIcon aria-hidden="true" />
                  )}
                  {t('protect.done.checkAgain')}
                </Button>
              )}
            </div>
          )}
        </List>
      )}

      <NextSteps>
        <NextStep n={1} title={t('protect.done.telegram.title')} body={t('protect.done.telegram.body')}>
          <div>
            {/* The one filled button once everything is protected; while something can be tried again, that is. */}
            <Button asChild variant={allDone ? 'primary' : 'outline'} className="h-auto min-h-10 max-w-full whitespace-normal">
              <a
                href={telegramUrl}
                target="_blank"
                rel={NEW_TAB_REL}
                aria-label={`${t('protect.done.telegram.action')} ${t('common.opensInNewTab')}`}
              >
                <SendIcon aria-hidden="true" />
                {t('protect.done.telegram.action')}
              </a>
            </Button>
          </div>
          {done === 0 || lockDate === null ? null : (
            // "Monitoring is on" reminds nobody: only the bot's reminders come before the lock ends (SECURITY-CHECK П11).
            <p role="note" data-risk="lock-ends" className="flex items-start gap-2 text-sm font-medium text-foreground">
              <ClockIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
              {t('protect.done.telegram.noReminder', { date: lockDate })}
            </p>
          )}
        </NextStep>
        {firstProtected === undefined ? null : (
          // One card for the pair of keys covers every account they lock (DECISIONS.md D74).
          <NextStep n={2} title={t('protect.done.recovery.title')} body={t('protect.done.recovery.body')}>
            <div>
              <Button asChild variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal">
                <Link href={appLinks.recovery(firstProtected.job.id as Address)}>
                  <FileTextIcon aria-hidden="true" />
                  {t('protect.done.recovery.open')}
                </Link>
              </Button>
            </div>
          </NextStep>
        )}
      </NextSteps>

      {nonceClose}

      <div>
        <Button asChild variant="ghost" className="-ml-4">
          <Link href={`/app?${new URLSearchParams({ address: mainKey }).toString()}`}>{t('common.backToAccounts')}</Link>
        </Button>
      </div>
    </section>
  );
}

/** "Locked until 12 April 2027 · Second key 9Dp…6fi": the second key short, with copy and explorer (UX rule 9). */
function DoneSubtitle({ date, secondKey }: { date: string; secondKey: Address }) {
  // The sentence lives in en.json whole; the address goes where its placeholder stands.
  const [before = '', after = ''] = t('protect.done.subtitle', { date }).split('{address}');
  return (
    <p data-slot="done-subtitle" className="flex flex-wrap items-center gap-x-1 pl-9 text-sm text-muted">
      <span>{before.trimEnd()}</span>
      <AddressText address={secondKey} />
      {after.trim() === '' ? null : <span>{after.trim()}</span>}
    </p>
  );
}

/** The account as the chain showed it once protected; undefined for an account that is not protected. */
function protectedAccountOf(job: JobView): StakeAccount | null | undefined {
  const { state } = job;
  return state.kind === 'done' || state.kind === 'already-done' ? state.after : undefined;
}

function List({ title, hidden = false, children }: { title: string; hidden?: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h3 id={id} className={hidden ? 'sr-only' : 'text-base font-semibold'}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function NextSteps({ children }: { children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} data-slot="next-steps" className="flex flex-col gap-4">
      <h3 id={id} className="text-base font-semibold">
        {t('protect.done.nextSteps')}
      </h3>
      <ol className="flex flex-col gap-4">{children}</ol>
    </section>
  );
}

function NextStep({ n, title, body, children }: { n: number; title: string; body: string; children: ReactNode }) {
  const id = useId();
  return (
    <li aria-labelledby={id} className="flex gap-3">
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary tabular-nums"
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-col gap-2">
        <h4 id={id} className="text-sm font-semibold">
          {title}
        </h4>
        <p className="max-w-prose text-sm text-muted">{body}</p>
        {children}
      </div>
    </li>
  );
}

function ProtectedRow({
  job,
  after,
  clock,
  secondKey,
}: {
  job: JobView;
  after: StakeAccount | null;
  clock: ClockView;
  secondKey: Address | null;
}) {
  const account = job.id as Address;
  const transaction =
    job.signature === null ? undefined : (
      <span className="inline-flex flex-wrap items-center gap-x-1">
        <span>{t('protect.done.transaction')}</span>
        <AddressText address={job.signature} kind="tx" />
      </span>
    );
  if (after === null) {
    // Applied on the chain but not readable as a stake account now: the outcome without the row.
    return (
      <div className="flex flex-col gap-2">
        <JobStatusList items={[{ address: account, status: 'done', signature: job.signature }]} label={t('protect.done.protectedList')} />
        {transaction}
      </div>
    );
  }
  const view = scannerStatus(after, [secondKey ?? after.lockup.custodian], clock);
  return (
    <AccountRow
      account={after}
      activation={stakeActivationStatus(after.delegation, clock.epoch)}
      clock={clock}
      protection={view.status}
      managedByService={view.managedByService}
      secondKeyKnown
      rescueHref={appLinks.rescue(after.withdrawer)}
      hint={false}
      serviceDetail
      meta={transaction}
    />
  );
}

/** A "Not protected yet" line: the refusal in the page's words, or what the engine says about the outcome. */
function notProtectedItem(job: JobView): JobStatusItem {
  const { state } = job;
  const item: JobStatusItem = { address: job.id as Address, status: jobStatus(state), signature: job.signature };
  const reason = state.kind === 'refused' ? refusalText(state.reason) : defaultJobReason(job);
  if (reason !== undefined) item.reason = reason;
  if (state.kind === 'failed' || state.kind === 'sim-failed') item.detail = state.error.detail;
  return item;
}

/** Monitoring in one line: its state by word, colour and icon (UX rule 5), and a way to turn it on again. */
function MonitoringLine({ watch, onRetry }: { watch: Exclude<WatchState, { kind: 'idle' }>; onRetry: () => void }) {
  return (
    <div role="status" data-watch={watch.kind} className="flex flex-col gap-1 pl-9 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {watch.kind === 'working' ? (
          <p className="flex items-center gap-2">
            <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin text-muted" />
            {t('protect.done.monitoring.working')}
          </p>
        ) : watch.kind === 'on' ? (
          <p className="flex items-start gap-2">
            <CircleCheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            {t('protect.done.monitoring.on')}
          </p>
        ) : watch.kind === 'partial' ? (
          <p className="flex items-start gap-2 font-medium">
            <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
            {t('protect.done.monitoring.partial')}
          </p>
        ) : (
          <p className="flex items-start gap-2 font-medium">
            <CircleXIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
            {t('protect.done.monitoring.failed')}
          </p>
        )}
        {watch.kind === 'partial' || watch.kind === 'failed' ? (
          <Button variant="ghost" size="sm" onClick={onRetry}>
            <RotateCcwIcon aria-hidden="true" />
            {t('protect.done.monitoring.retry')}
          </Button>
        ) : null}
      </div>
      {watch.kind === 'partial' ? (
        <ErrorDetails detail={watch.rejected.map(({ account, reason }) => `${account}: ${reason}`).join('\n')} />
      ) : watch.kind === 'failed' ? (
        <ErrorDetails detail={watch.detail} />
      ) : null}
    </div>
  );
}
