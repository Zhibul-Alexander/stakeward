import type { Address } from '@solana/kit';
import { scannerStatus, shortAddress, stakeActivationStatus, type ClockView, type StakeAccount } from '@stakeward/core';
import { CircleCheckIcon, LoaderCircleIcon, RotateCcwIcon, SearchIcon, SendIcon } from 'lucide-react';
import { useId, type ReactNode, type Ref } from 'react';
import { Link } from 'wouter';
import { AccountRow } from '@/components/product/account-row';
import { AddressText } from '@/components/product/address-text';
import { ErrorDetails } from '@/components/product/error-state';
import { JobStatusList, type JobStatusItem } from '@/components/product/job-status-list';
import { RiskNote } from '@/components/product/risk-note';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { telegramLinkPath } from '@/api/telegram';
import type { WatchState } from '@/api/watch';
import { t } from '@/i18n';
import type { JobView } from '@/signing/machine';
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
  actions: ProtectDoneActions;
};

/** Statuses need a clock; a finished run always carries one, this only keeps the type honest. */
const NO_CLOCK: ClockView = { unixTimestamp: 0n, epoch: 0n };

/** The Done step of the wizard: its outcomes in order, the second key the chain shows, Telegram for the main key. */
export function DoneStep({
  state,
  mainKey,
  secondKeySlot,
  ...rest
}: Pick<ProtectDoneViewProps, 'headingRef' | 'watch' | 'checking' | 'checkFailed' | 'actions'> & {
  state: WizardState;
  mainKey: Address;
  /** The second key slot's address, used when no protected account names the second key. */
  secondKeySlot: Address | null;
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
    />
  );
}

/** A link that opens in a new tab shares neither this page (window.opener) nor its address (Referer). */
const NEW_TAB_REL = 'noopener noreferrer';

const RETRYABLE: readonly JobView['state']['kind'][] = ['sim-failed', 'failed', 'expired', 'not-sent'];

/**
 * The Done screen of the protect wizard (F1 step 7), presentational so /dev/ui can show it with fixtures: what the
 * chain now shows protected, what is not protected yet and the one way forward for it, the second key and its risk,
 * monitoring, Telegram alerts and the recovery card.
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
  actions,
}: ProtectDoneViewProps) {
  const headingId = useId();
  const protectedJobs = outcomes.flatMap((job) => {
    const after = protectedAccountOf(job);
    return after === undefined ? [] : [{ job, after }];
  });
  const others = outcomes.filter((job) => protectedAccountOf(job) === undefined);
  const total = outcomes.length;
  const done = protectedJobs.length;
  const title =
    done === 0
      ? t('protect.done.titleNone')
      : done < total
        ? t('protect.done.titlePartial', { done, total })
        : done === 1
          ? t('protect.done.titleOne')
          : t('protect.done.titleOther', { count: done });
  const retryable = others.filter((job) => RETRYABLE.includes(job.state.kind));
  const uncertain = others.filter((job) => job.state.kind === 'unknown');
  const lockEndPassed = others.some((job) => job.state.kind === 'refused' && job.state.reason === 'lock-end-passed');

  return (
    <section aria-labelledby={headingId} data-slot="protect-done" className="flex flex-col gap-8">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-2xl font-semibold">
        {title}
      </h2>

      {protectedJobs.length === 0 ? null : (
        <List title={t('protect.done.protectedList')}>
          <ul className="flex flex-col gap-3">
            {protectedJobs.map(({ job, after }) => (
              <li key={job.id}>
                <ProtectedRow job={job} after={after} clock={clock} secondKey={secondKey} />
              </li>
            ))}
          </ul>
        </List>
      )}

      {others.length === 0 ? null : (
        <List title={t('protect.done.notProtectedList')}>
          <JobStatusList items={others.map(notProtectedItem)} label={t('protect.done.notProtectedList')} />
          {checkFailed ? (
            <p role="status" className="text-sm font-medium text-danger">
              {t('protect.done.checkFailed')}
            </p>
          ) : null}
          {retryable.length === 0 && uncertain.length === 0 && !lockEndPassed ? null : (
            <div className="flex flex-wrap gap-2">
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

      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
        {done === 0 || secondKey === null ? null : (
          <DoneCard title={t('protect.done.secondKey')}>
            <AddressText address={secondKey} variant="full" />
            <RiskNote risk="lose-second-key" date={lockUntil ?? undefined} />
          </DoneCard>
        )}
        {watch.kind === 'idle' ? null : <MonitoringCard watch={watch} onRetry={actions.retryMonitoring} />}
        <DoneCard title={t('protect.done.telegram.title')} description={t('protect.done.telegram.body')}>
          <div>
            <Button asChild variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal">
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
        </DoneCard>
        {done === 0 ? null : (
          <DoneCard title={t('protect.done.recovery.title')} description={t('protect.done.recovery.body')}>
            <ul className="flex flex-col gap-1">
              {protectedJobs.map(({ job }) => (
                <li key={job.id}>
                  <RecoveryLink account={job.id as Address} />
                </li>
              ))}
            </ul>
          </DoneCard>
        )}
      </div>

      <div>
        <Button asChild>
          <Link href={`/app?${new URLSearchParams({ address: mainKey }).toString()}`}>{t('common.backToAccounts')}</Link>
        </Button>
      </div>
    </section>
  );
}

/** The account as the chain showed it once protected; undefined for an account that is not protected. */
function protectedAccountOf(job: JobView): StakeAccount | null | undefined {
  const { state } = job;
  return state.kind === 'done' || state.kind === 'already-done' ? state.after : undefined;
}

function List({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h3 id={id} className="text-xl font-semibold">
        {title}
      </h3>
      {children}
    </section>
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
  const links = (
    <>
      {job.signature === null ? null : (
        <span className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="text-muted">{t('protect.done.transaction')}</span>
          <AddressText address={job.signature} kind="tx" />
        </span>
      )}
      <RecoveryLink account={account} />
    </>
  );
  if (after === null) {
    // Applied on the chain but not readable as a stake account now: the outcome without the row.
    return (
      <div className="flex flex-col gap-2">
        <JobStatusList items={[{ address: account, status: 'done', signature: job.signature }]} label={t('protect.done.protectedList')} />
        {links}
      </div>
    );
  }
  const view = scannerStatus(after, [secondKey ?? after.lockup.custodian], clock);
  return (
    <AccountRow
      account={after}
      activation={stakeActivationStatus(after.delegation, clock.epoch)}
      protection={view.status}
      managedByService={view.managedByService}
      actions={links}
    />
  );
}

function RecoveryLink({ account }: { account: Address }) {
  return (
    <Link
      href={`/recovery/${account}`}
      className="rounded-sm text-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
    >
      {t('protect.done.recovery.link', { address: shortAddress(account) })}
    </Link>
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

function DoneCard({ title, description, children }: { title: string; description?: string | undefined; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle asChild>
          <h3>{title}</h3>
        </CardTitle>
        {description === undefined ? null : <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

function MonitoringCard({ watch, onRetry }: { watch: Exclude<WatchState, { kind: 'idle' }>; onRetry: () => void }) {
  const retry = (
    <div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCcwIcon aria-hidden="true" />
        {t('protect.done.monitoring.retry')}
      </Button>
    </div>
  );
  return (
    <DoneCard title={t('protect.done.monitoring.title')}>
      <div role="status" data-watch={watch.kind} className="flex flex-col gap-3 text-sm">
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
          <>
            <p>{t('protect.done.monitoring.partial')}</p>
            <ErrorDetails detail={watch.rejected.map(({ account, reason }) => `${account}: ${reason}`).join('\n')} />
          </>
        ) : (
          <>
            <p>{t('protect.done.monitoring.failed')}</p>
            <ErrorDetails detail={watch.detail} />
          </>
        )}
      </div>
      {watch.kind === 'partial' || watch.kind === 'failed' ? retry : null}
    </DoneCard>
  );
}
