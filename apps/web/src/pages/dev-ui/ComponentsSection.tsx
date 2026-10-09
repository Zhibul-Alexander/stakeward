import { cliUrl, formatSol, formatUtcDate, LEDGER_PUBKEY_COMMAND, lockupEndForPeriod, recoveryCommands, shortAddress, U64_MAX } from '@stakeward/core';
import { RotateCcwIcon, SendIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { AccountList, AccountListItem, AccountListSkeleton, AccountRow, AccountRowError } from '@/components/product/account-row';
import { ActionBar } from '@/components/product/action-bar';
import { AddressText, AddressTextSkeleton } from '@/components/product/address-text';
import { CommandBlock, CommandBlockSkeleton } from '@/components/product/command-block';
import { CosignRequest } from '@/components/product/cosign-request';
import { Disclosure } from '@/components/product/disclosure';
import { Countdown, CountdownSkeleton } from '@/components/product/countdown';
import { NoStakeAccounts } from '@/components/product/empty-state';
import { ErrorState } from '@/components/product/error-state';
import { FaqItem } from '@/components/product/faq-item';
import { JobStatusList } from '@/components/product/job-status-list';
import { KeyList, KeyListSkeleton } from '@/components/product/key-list';
import { LinkCard } from '@/components/product/link-card';
import { QrCode } from '@/components/product/qr-code';
import { RadioCardGroup, type RadioCardOption } from '@/components/product/radio-card';
import { RiskNote } from '@/components/product/risk-note';
import { SignerList, SignerListSkeleton } from '@/components/product/signer-list';
import { SolAmount, SolAmountSkeleton } from '@/components/product/sol-amount';
import { StatusBadge, StatusBadgeSkeleton, type StatusBadgeStatus } from '@/components/product/status-badge';
import { StepProgress } from '@/components/product/step-progress';
import { StopPanel } from '@/components/product/stop-panel';
import { SummaryBar } from '@/components/product/summary-bar';
import { SupportBadge, type SupportVerdict } from '@/components/product/support-badge';
import {
  TransactionSummary,
  TransactionSummaryError,
  TransactionSummarySkeleton,
} from '@/components/product/transaction-summary';
import { WalletSlot } from '@/components/product/wallet-slot';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/i18n';
import type { HealthState } from '@/pages/app/hooks';
import { MonitoringStatus } from '@/pages/app/MonitoringStatus';
import { appLinks } from '@/pages/app/view';
import { FaqAnswer } from '@/pages/landing/Faq.tsx';
import { REMINDER_DAYS_TEXT } from '@/pages/landing/faq.ts';
import { DarkPreview } from './DarkPreview.tsx';
import { Demo, DemoGroup, DevSection } from './layout.tsx';
import {
  SAMPLE,
  SAMPLE_ERROR_DETAIL,
  SAMPLE_LOCK_END,
  SAMPLE_SIGNATURE,
  SAMPLE_TX,
  SAMPLE_WALLETS,
  sampleClock,
  sampleExpiringEnd,
  sampleJobs,
  sampleLinkUrl,
  sampleRows,
  sampleSigners,
  sampleSignersEveryStatus,
  sampleSummaries,
  type SampleRow,
  type SampleSummary,
} from './samples.ts';

const noop = () => undefined;

/** More than a version 40 QR code holds (2953 bytes at level L). */
const TOO_LONG_FOR_QR = 'x'.repeat(3000);

const STATUSES: readonly StatusBadgeStatus[] = [
  'protected',
  'expiring',
  'unprotected',
  'locked-by-other',
  'was-protected',
  'unknown',
];

const [WALLET_A, WALLET_B] = SAMPLE_WALLETS;

const VERDICTS: readonly SupportVerdict[] = ['not-verified', 'works', 'works-with-warning', 'blind-signing', 'does-not-work'];

/** The recovery card's commands for the sample main key, on devnet as the card of a devnet build shows them. */
const COMMANDS = recoveryCommands({ mainKeyAddress: SAMPLE.mainKey, url: cliUrl('devnet') });

/** The FAQ's parameter in these answers, as the landing fills it: "30, 14, 7, 3, and 1". */
const FAQ_PARAMS = { days: REMINDER_DAYS_TEXT };

/** The actions a row would have on /app for its status: one visible, the others behind its More. */
function rowActions(row: SampleRow): { action?: ReactNode; more?: ReactNode } {
  if (row.protection === 'unprotected') {
    return {
      action: (
        <Button size="sm" variant="outline">
          {t('devUi.sample.protect')}
        </Button>
      ),
    };
  }
  if (row.protection === 'locked-by-other') return {};
  return {
    action: (
      <Button size="sm" variant="outline">
        {t('devUi.sample.extend')}
      </Button>
    ),
    more: (
      <>
        <Button size="sm" variant="outline">
          {t('devUi.sample.withdraw')}
        </Button>
        <Button size="sm" variant="outline">
          {t('devUi.sample.rescue')}
        </Button>
      </>
    ),
  };
}

/** One sample row as /app would render it: its action and More, the hint once per group unless `hint`. */
function SampleAccountRow({ row, hint = false, defaultMoreOpen }: { row: SampleRow; hint?: boolean; defaultMoreOpen?: boolean }) {
  const { action, more } = rowActions(row);
  return (
    <AccountRow
      account={row.account}
      activation={row.activation}
      clock={row.clock}
      protection={row.protection}
      managedByService={row.managedByService}
      secondKeyKnown={row.secondKeyKnown}
      wasProtected={row.wasProtected}
      rescueHref={appLinks.rescue(row.account.withdrawer)}
      action={action}
      moreActions={more}
      defaultMoreOpen={defaultMoreOpen}
      hint={hint}
      serviceDetail
    />
  );
}

/** Protect step 1: the rows a main key can choose, with their checkboxes; a lock of another key cannot be chosen. */
function SelectableRows({ rows }: { rows: readonly SampleRow[] }) {
  const [chosen, setChosen] = useState<readonly string[]>(() => rows.filter((row) => row.protection === 'unprotected').map((row) => row.key));
  return (
    <AccountList label={t('devUi.states.selectable')}>
      {rows.map((row) => {
        const blocked = row.protection !== 'unprotected';
        return (
          <AccountListItem key={row.key}>
            <AccountRow
              account={row.account}
              activation={row.activation}
              clock={row.clock}
              protection={row.protection}
              managedByService={row.managedByService}
              secondKeyKnown={row.secondKeyKnown}
              hint={false}
              serviceDetail
              select={{
                checked: !blocked && chosen.includes(row.key),
                disabled: blocked,
                label: t('protect.accounts.select', { address: shortAddress(row.account.address) }),
                onCheckedChange: (checked) => {
                  setChosen((current) => (checked ? [...current, row.key] : current.filter((key) => key !== row.key)));
                },
              }}
            />
          </AccountListItem>
        );
      })}
    </AccountList>
  );
}

/** Telegram and Refresh, as /app puts them next to "Last checked". */
function SummaryTools() {
  return (
    <>
      <Button variant="outline" size="sm">
        <SendIcon aria-hidden="true" />
        {t('app.results.telegram')}
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={t('app.results.refresh')}>
        <RotateCcwIcon aria-hidden="true" />
      </Button>
    </>
  );
}

function RescueFooter() {
  return (
    <p className="flex flex-wrap items-center gap-x-2">
      {t('app.results.rescueNote')}
      <Link href="/rescue" className="rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover">
        {t('app.results.rescue')}
      </Link>
    </p>
  );
}

const PERIOD_MONTHS = [1, 3, 6, 12] as const;
const PERIOD_TITLE = { 1: 'devUi.period1', 3: 'devUi.period3', 6: 'devUi.period6', 12: 'devUi.period12' } as const;

/** A RadioCardGroup with its own state (the /dev/ui samples are not wired to a page). */
function RadioCardDemo({ legend, options, initial }: { legend: string; options: readonly RadioCardOption[]; initial: string }) {
  const [value, setValue] = useState(initial);
  return <RadioCardGroup legend={legend} value={value} onValueChange={setValue} options={options} columns={2} />;
}

function SummaryDemo({ sample }: { sample: SampleSummary }) {
  const context = !sample.ok
    ? null
    : sample.batch !== undefined
      ? t('devUi.states.batch', { count: sample.batch.accounts.length })
      : t(sample.current === undefined ? 'devUi.states.withoutContext' : 'devUi.states.withContext');
  const label = sample.ok ? `${t(`components.tx.kind.${sample.summary.action.kind}`)} · ${context ?? ''}` : t('devUi.states.rejected');
  return (
    <Demo label={label}>
      {sample.ok ? (
        <TransactionSummary summary={sample.summary} current={sample.current} batch={sample.batch} headingLevel={3} />
      ) : (
        <TransactionSummaryError
          error={sample.error}
          headingLevel={3}
          action={
            <Button size="sm" variant="outline">
              {t('common.backToAccounts')}
            </Button>
          }
        />
      )}
    </Demo>
  );
}

export function ComponentsSection() {
  // One clock for the whole page so every status is computed against the same "now".
  const [clock] = useState(sampleClock);
  const [rows] = useState(() => sampleRows(clock));
  const [signers] = useState(sampleSigners);
  const [signersEveryStatus] = useState(sampleSignersEveryStatus);
  const [jobs] = useState(sampleJobs);
  const [summaries, setSummaries] = useState<SampleSummary[] | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    sampleSummaries(clock).then(
      (result) => {
        if (!cancelled) setSummaries(result);
      },
      (error: unknown) => {
        if (!cancelled) setSummaryError(String(error));
      },
    );
    // The signing link of a rescue on a durable nonce on this site: the longest link, the densest QR code.
    sampleLinkUrl(window.location.origin).then(
      (url) => {
        if (!cancelled) setLinkUrl(url);
      },
      (error: unknown) => {
        if (!cancelled) setSummaryError(String(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [clock]);

  const steps = [t('devUi.sample.stepAccounts'), t('devUi.sample.stepSecondKey'), t('devUi.sample.stepPeriod'), t('devUi.sample.stepSign')];
  const health = (minutesAgo: number): HealthState => ({
    status: 'ready',
    health: { lastMonitorRunAt: new Date(now - minutesAgo * 60_000) },
    receivedAt: now,
  });
  const fresh = <MonitoringStatus state={health(2)} now={now} />;
  const periodOption = (months: (typeof PERIOD_MONTHS)[number]): RadioCardOption => ({
    value: String(months),
    title: t(PERIOD_TITLE[months]),
    meta: t('components.status.until', { date: formatUtcDate(lockupEndForPeriod(clock.unixTimestamp, months)) ?? '' }),
    badge: months === 6 ? <Badge tone="success">{t('devUi.sample.recommended')}</Badge> : undefined,
  });
  const removeOption: RadioCardOption = {
    value: 'remove',
    title: t('devUi.sample.removeLock'),
    description: t('devUi.sample.removeLockHint'),
    tone: 'danger',
  };
  const byKey = (key: SampleRow['key']) => rows.filter((row) => row.key === key);
  const epochEnd = clock.unixTimestamp + 2n * 3_600n + 14n * 60n;
  const soon = clock.unixTimestamp + 4n * 60n + 30n;

  return (
    <DevSection id="components" title={t('devUi.productComponents')}>
      <DemoGroup title={t('devUi.names.statusBadge')}>
        <Demo label={t('devUi.states.normal')}>
          <div className="flex flex-wrap items-center gap-2">
            {STATUSES.map((status) => (
              <StatusBadge key={status} status={status} />
            ))}
            {/* The same lock once this browser knows a second key that does not hold it (D35). */}
            <StatusBadge status="locked-by-other" secondKeyKnown />
          </div>
        </Demo>
        <Demo label={t('devUi.states.loading')}>
          <StatusBadgeSkeleton />
        </Demo>
      </DemoGroup>

      <DemoGroup title={t('devUi.names.addressText')}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Demo label={t('devUi.states.short')}>
            <AddressText address={SAMPLE.stakeA} />
          </Demo>
          <Demo label={t('devUi.states.signature')}>
            <AddressText address={SAMPLE_SIGNATURE} kind="tx" />
          </Demo>
          <Demo label={t('devUi.states.full')}>
            <AddressText address={SAMPLE.secondKey} variant="full" />
          </Demo>
          <Demo label={t('devUi.states.loading')}>
            <AddressTextSkeleton />
          </Demo>
        </div>
      </DemoGroup>

      <DemoGroup title={t('devUi.names.solAmount')}>
        <div className="flex flex-wrap gap-6">
          <Demo label={t('devUi.states.normal')}>
            <SolAmount lamports={1_250_500_000_000n} className="text-lg font-semibold" />
          </Demo>
          <Demo label={t('devUi.states.oneLamport')}>
            <SolAmount lamports={1n} />
          </Demo>
          <Demo label={t('devUi.states.zero')}>
            <SolAmount lamports={0n} />
          </Demo>
          <Demo label={t('devUi.states.largest')}>
            <SolAmount lamports={U64_MAX} />
          </Demo>
          <Demo label={t('devUi.states.loading')}>
            <SolAmountSkeleton />
          </Demo>
        </div>
      </DemoGroup>

      <DemoGroup title={t('devUi.names.accountRow')}>
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          <Demo label={t('devUi.states.inList')} className="lg:col-span-2">
            <AccountList label={t('devUi.states.inList')} actionColumns>
              {rows.map((row) => (
                <AccountListItem key={row.key}>
                  <SampleAccountRow row={row} />
                </AccountListItem>
              ))}
            </AccountList>
          </Demo>
          <Demo label={t('devUi.states.withHint')}>
            <AccountList label={t('devUi.states.withHint')}>
              {[...byKey('protected'), ...byKey('locked-new-device'), ...byKey('was-protected')].map((row) => (
                <AccountListItem key={row.key}>
                  <SampleAccountRow row={row} hint />
                </AccountListItem>
              ))}
            </AccountList>
          </Demo>
          <Demo label={t('devUi.states.selectable')}>
            <SelectableRows rows={[...byKey('unprotected'), ...byKey('managed-by-service'), ...byKey('locked-by-other')]} />
          </Demo>
          <Demo label={t('devUi.states.moreOpen')}>
            <AccountList label={t('devUi.states.moreOpen')}>
              {byKey('protected').map((row) => (
                <AccountListItem key={row.key}>
                  <SampleAccountRow row={row} defaultMoreOpen />
                </AccountListItem>
              ))}
            </AccountList>
          </Demo>
          <Demo label={t('devUi.states.secondKeyFor')}>
            <AccountList label={t('devUi.states.secondKeyFor')}>
              {byKey('expiring').map((row) => (
                <AccountListItem key={row.key}>
                  <AccountRow
                    account={row.account}
                    activation={row.activation}
                    clock={row.clock}
                    protection={row.protection}
                    managedByService={false}
                    secondKeyKnown
                    hint={false}
                    meta={
                      <span className="inline-flex items-center gap-x-1">
                        <span>{t('common.roles.main')}</span>
                        <AddressText address={SAMPLE.newWallet} />
                      </span>
                    }
                    action={
                      <Button size="sm" variant="outline">
                        {t('devUi.sample.extend')}
                      </Button>
                    }
                    moreActions={
                      <Button size="sm" variant="outline">
                        {t('app.actions.recovery')}
                      </Button>
                    }
                  />
                </AccountListItem>
              ))}
            </AccountList>
          </Demo>
          <Demo label={t('devUi.states.loading')}>
            <AccountListSkeleton />
          </Demo>
          <Demo label={t('devUi.states.error')}>
            <AccountList label={t('devUi.states.error')}>
              <AccountListItem>
                <AccountRowError address={SAMPLE.stakeB} detail={SAMPLE_ERROR_DETAIL.rpc} onRetry={noop} />
              </AccountListItem>
            </AccountList>
          </Demo>
        </div>
      </DemoGroup>

      <DemoGroup title={t('devUi.names.summaryBar')}>
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          <Demo label={t('devUi.states.normal')}>
            <SummaryBar
              label={`${t('devUi.names.summaryBar')} · ${t('devUi.states.normal')}`}
              state="ready"
              headline={t('devUi.sample.summaryHeadline')}
              detail={t('devUi.sample.summaryDetail')}
              monitoring={fresh}
              tools={<SummaryTools />}
              footer={<RescueFooter />}
            />
          </Demo>
          <Demo label={t('devUi.states.loading')}>
            <SummaryBar
              label={`${t('devUi.names.summaryBar')} · ${t('devUi.states.loading')}`}
              state="loading"
              monitoring={<MonitoringStatus state={{ status: 'loading' }} now={now} />}
              tools={<SummaryTools />}
            />
          </Demo>
          <Demo label={t('devUi.states.error')}>
            <div className="flex flex-col gap-3">
              <SummaryBar
                label={`${t('devUi.names.summaryBar')} · ${t('devUi.states.error')}`}
                state="error"
                monitoring={fresh}
                tools={<SummaryTools />}
              />
              <ErrorState title={t('app.results.errorTitle')} message={t('errors.network')} detail={SAMPLE_ERROR_DETAIL.rpc} onRetry={noop} />
            </div>
          </Demo>
          <Demo label={t('devUi.states.stale')}>
            <SummaryBar
              label={`${t('devUi.names.summaryBar')} · ${t('devUi.states.stale')}`}
              state="ready"
              headline={t('devUi.sample.summaryHeadline')}
              detail={t('devUi.sample.summaryDetail')}
              monitoring={<MonitoringStatus state={health(25)} now={now} />}
              tools={<SummaryTools />}
              footer={<RescueFooter />}
            />
          </Demo>
          <Demo label={t('devUi.states.newDevice')}>
            <SummaryBar
              label={`${t('devUi.names.summaryBar')} · ${t('devUi.states.newDevice')}`}
              state="ready"
              headline={t('devUi.sample.summaryHeadline')}
              detail={
                <>
                  <p>{t('devUi.sample.summaryDetail')}</p>
                  <p>{t('devUi.sample.summaryNewDevice')}</p>
                </>
              }
              monitoring={fresh}
              tools={<SummaryTools />}
              action={<Button variant="outline">{t('devUi.sample.connectSecond')}</Button>}
              footer={<RescueFooter />}
            />
          </Demo>
          <Demo label={t('devUi.states.secondKeyOnly')}>
            <SummaryBar
              label={`${t('devUi.names.summaryBar')} · ${t('devUi.states.secondKeyOnly')}`}
              state="ready"
              detail={t('devUi.sample.summarySecondKeyFor')}
              monitoring={fresh}
              tools={<SummaryTools />}
            />
          </Demo>
        </div>
      </DemoGroup>

      <DemoGroup title={t('devUi.names.emptyState')}>
        <Demo label={t('devUi.states.empty')}>
          <NoStakeAccounts
            address={SAMPLE.stranger}
            headingLevel={3}
            action={
              <Button size="sm" variant="outline">
                {t('devUi.sample.checkAnother')}
              </Button>
            }
          />
        </Demo>
      </DemoGroup>

      <DemoGroup title={t('devUi.names.walletSlot')}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Demo label={t('devUi.states.loading')}>
            <WalletSlot role="main" status="loading" />
          </Demo>
          <Demo label={t('devUi.states.empty')}>
            <WalletSlot role="main" status="empty" wallets={SAMPLE_WALLETS} onConnect={noop} />
          </Demo>
          <Demo label={t('devUi.states.pickerOpen')}>
            <WalletSlot role="second" status="empty" wallets={SAMPLE_WALLETS} onConnect={noop} defaultPickerOpen />
          </Demo>
          <Demo label={t('devUi.states.noWallets')}>
            <WalletSlot role="new" status="empty" wallets={[]} onConnect={noop} defaultPickerOpen />
          </Demo>
          <Demo label={t('devUi.states.connecting')}>
            <WalletSlot role="second" status="connecting" wallet={WALLET_B} onCancel={noop} />
          </Demo>
          <Demo label={t('devUi.states.connected')}>
            <WalletSlot role="main" status="connected" wallet={WALLET_A} address={SAMPLE.mainKey} onDisconnect={noop} />
          </Demo>
          <Demo label={t('devUi.states.error')}>
            <WalletSlot
              role="second"
              status="error"
              wallet={WALLET_B}
              message={t('devUi.sample.connectionLost')}
              detail={SAMPLE_ERROR_DETAIL.wallet}
              onRetry={noop}
              onCancel={noop}
            />
          </Demo>
          <Demo label={t('devUi.states.wrongAccount')}>
            <WalletSlot
              role="second"
              status="wrong-account"
              wallet={WALLET_A}
              address={SAMPLE.mainKey}
              conflictRole="main"
              onContinue={noop}
              onDisconnect={noop}
            />
          </Demo>
          <Demo label={t('devUi.states.wrongAccountExpected')}>
            <WalletSlot
              role="second"
              status="wrong-account"
              wallet={WALLET_B}
              address={SAMPLE.mainKey}
              expected={SAMPLE.secondKey}
              onContinue={noop}
              onDisconnect={noop}
            />
          </Demo>
          <Demo label={t('devUi.states.wrongAccountHeld')}>
            <WalletSlot
              role="main"
              status="wrong-account"
              wallet={WALLET_A}
              address={SAMPLE.secondKey}
              expected={SAMPLE.mainKey}
              onDisconnect={noop}
            />
          </Demo>
          <Demo label={t('devUi.states.connectLabel')}>
            <WalletSlot
              role="main"
              status="empty"
              wallets={SAMPLE_WALLETS}
              onConnect={noop}
              emphasis="primary"
              connectLabel={t('devUi.sample.orConnect')}
              description={t('devUi.sample.slotDescription')}
            />
          </Demo>
          <Demo label={t('devUi.states.inlineEmpty')}>
            <WalletSlot role="main" status="empty" wallets={SAMPLE_WALLETS} onConnect={noop} layout="inline" connectLabel={t('devUi.sample.connectMain')} />
          </Demo>
          <Demo label={t('devUi.states.inlineConnected')}>
            <WalletSlot role="main" status="connected" wallet={WALLET_A} address={SAMPLE.mainKey} onDisconnect={noop} layout="inline" />
          </Demo>
          <Demo label={t('devUi.states.inlineError')}>
            <WalletSlot
              role="second"
              status="error"
              wallet={WALLET_B}
              message={t('devUi.sample.connectionLost')}
              detail={SAMPLE_ERROR_DETAIL.wallet}
              onRetry={noop}
              onCancel={noop}
              layout="inline"
            />
          </Demo>
        </div>
      </DemoGroup>

      <DemoGroup title={t('devUi.names.transactionSummary')}>
        {summaryError === null ? null : <ErrorState title={t('devUi.states.error')} message={summaryError} />}
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          {summaries === null ? (
            <>
              <TransactionSummarySkeleton />
              <TransactionSummarySkeleton />
            </>
          ) : (
            summaries.map((sample) => <SummaryDemo key={sample.key} sample={sample} />)
          )}
          <Demo label={t('devUi.states.loading')}>
            <TransactionSummarySkeleton />
          </Demo>
        </div>
      </DemoGroup>

      <DemoGroup title={t('devUi.names.signerList')}>
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          <Demo label={t('devUi.states.normal')}>
            <SignerList items={signers} />
          </Demo>
          <Demo label={t('devUi.states.loading')}>
            <SignerListSkeleton />
          </Demo>
          <Demo label={t('devUi.states.everyStatus')} className="lg:col-span-2">
            <SignerList items={signersEveryStatus} />
          </Demo>
        </div>
      </DemoGroup>

      <DemoGroup title={t('devUi.names.jobStatusList')}>
        <Demo label={t('devUi.states.everyStatus')}>
          <JobStatusList items={jobs} label={t('devUi.sample.jobs')} />
        </Demo>
      </DemoGroup>

      <DemoGroup title={t('devUi.names.qrCode')}>
        <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
          <Demo label={t('devUi.states.normal')}>
            {linkUrl === null ? (
              <Skeleton className="aspect-square w-full max-w-80" />
            ) : (
              <QrCode value={linkUrl} label={t('signing.link.qrLabel')} />
            )}
          </Demo>
          <Demo label={t('devUi.states.tooLong')}>
            <QrCode value={TOO_LONG_FOR_QR} label={t('signing.link.qrLabel')} />
          </Demo>
        </div>
      </DemoGroup>

      <DemoGroup title={t('devUi.names.linkCard')}>
        {linkUrl === null ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
            <Demo label={t('devUi.states.watching')}>
              <LinkCard url={linkUrl} signature={SAMPLE_TX} signers={[{ role: 'second', address: SAMPLE.secondKey }]} watching lastCheckFailed={false} />
            </Demo>
            <Demo label={t('devUi.states.checkFailed')}>
              <LinkCard
                url={linkUrl}
                signature={SAMPLE_TX}
                signers={[
                  { role: 'main', address: SAMPLE.mainKey },
                  { role: 'second', address: SAMPLE.secondKey },
                ]}
                watching
                lastCheckFailed
              />
            </Demo>
            <Demo label={t('devUi.states.paused')}>
              <LinkCard url={linkUrl} signature={SAMPLE_TX} signers={[{ role: 'second', address: SAMPLE.secondKey }]} watching={false} lastCheckFailed={false} />
            </Demo>
          </div>
        )}
      </DemoGroup>

      <DemoGroup title={t('devUi.names.cosignRequest')}>
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
          <Demo label={t('components.tx.kind.protect')}>
            <CosignRequest
              kind="protect"
              from="main"
              ask={t('cosign.ask.protect.title', { date: formatUtcDate(SAMPLE_LOCK_END) ?? '' })}
              lines={[
                t('cosign.ask.protect.needs'),
                t('cosign.ask.protect.lose', { date: formatUtcDate(SAMPLE_LOCK_END) ?? '' }),
                t('cosign.ask.protect.cannot'),
              ]}
              meta={t('cosign.holds', { amount: formatSol(1_250_500_000_000n) })}
            />
          </Demo>
          <Demo label={t('components.tx.kind.rescue')}>
            <CosignRequest
              kind="rescue"
              from="new"
              ask={t('cosign.ask.rescue.title')}
              check={{
                title: t('cosign.ask.rescue.check'),
                lines: [t('cosign.ask.rescue.thief'), t('cosign.ask.rescue.only')],
                role: 'new',
                address: SAMPLE.newWallet,
              }}
            />
          </Demo>
        </div>
      </DemoGroup>

      <DemoGroup title={t('devUi.names.stopPanel')}>
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
          <Demo label={t('devUi.states.withEverything')}>
            <StopPanel
              title={t('cosign.stop.title')}
              reason={t('cosign.problem.foreign-recipient', { amount: formatSol(1_250_500_000_000n) })}
              addresses={[
                { label: t('cosign.stop.goesTo'), address: SAMPLE.newWallet },
                { label: t('cosign.stop.mainKey'), address: SAMPLE.mainKey },
              ]}
              whatToDo={t('cosign.stop.whatToDo')}
              action={<Button variant="outline">{t('common.backHome')}</Button>}
            />
          </Demo>
          <Demo label={t('devUi.states.rejected')}>
            <StopPanel
              title={t('cosign.stop.title')}
              reason={t('components.tx.rejected.unknown-program')}
              whatToDo={t('cosign.stop.whatToDo')}
              detail={SAMPLE_ERROR_DETAIL.fetch}
              action={<Button variant="outline">{t('common.backHome')}</Button>}
            />
          </Demo>
        </div>
      </DemoGroup>

      <DemoGroup title={t('devUi.names.stepProgress')} note={t('devUi.stepProgressNote')}>
        <div className="flex flex-col gap-6">
          <Demo label={t('devUi.states.first')}>
            <StepProgress steps={steps} current={0} />
          </Demo>
          <Demo label={t('devUi.states.middle')}>
            <StepProgress steps={steps} current={2} />
          </Demo>
          <Demo label={t('devUi.states.last')}>
            <StepProgress steps={steps} current={3} />
          </Demo>
          <Demo label={t('devUi.states.failed')}>
            <StepProgress steps={steps} current={3} failed={3} />
          </Demo>
        </div>
      </DemoGroup>

      <DemoGroup title={t('devUi.names.countdown')}>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Demo label={t('devUi.states.running')}>
            <Countdown to={epochEnd} label={t('devUi.sample.epochEnds')} />
          </Demo>
          <Demo label={t('devUi.states.endingSoon')}>
            <Countdown to={soon} label={t('devUi.sample.epochEnds')} />
          </Demo>
          <Demo label={t('devUi.states.ended')}>
            <Countdown to={clock.unixTimestamp - 60n} label={t('devUi.sample.lockEndsIn')} />
          </Demo>
          <Demo label={t('devUi.states.loading')}>
            <CountdownSkeleton />
          </Demo>
        </div>
      </DemoGroup>

      <DemoGroup title={t('devUi.names.riskNote')}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <RiskNote risk="lose-second-key" date={SAMPLE_LOCK_END} />
          <RiskNote risk="second-key-can-freeze" />
          <RiskNote risk="withdraw-compromised" />
          <RiskNote risk="lock-ends" date={sampleExpiringEnd(clock)} />
          <RiskNote risk="unlock-opens-window" tone="danger" />
          <Demo label={t('devUi.states.dateTime')}>
            <RiskNote risk="lock-ends" date={sampleExpiringEnd(clock)} dateStyle="date-time" />
          </Demo>
          <Demo label={t('devUi.states.inlineWarning')}>
            <RiskNote risk="lose-second-key" date={SAMPLE_LOCK_END} variant="inline" />
          </Demo>
          <Demo label={t('devUi.states.inlineDanger')}>
            <RiskNote risk="unlock-opens-window" tone="danger" variant="inline" />
          </Demo>
        </div>
      </DemoGroup>

      <DemoGroup title={t('devUi.names.radioCardGroup')}>
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          <Demo label={t('devUi.states.lockPeriod')}>
            <RadioCardDemo legend={t('devUi.periodLabel')} options={PERIOD_MONTHS.map(periodOption)} initial="6" />
          </Demo>
          <Demo label={t('devUi.states.withDanger')}>
            <RadioCardDemo
              legend={t('devUi.sample.newEnd')}
              options={[...([3, 6, 12] as const).map(periodOption), removeOption]}
              initial="remove"
            />
          </Demo>
        </div>
      </DemoGroup>

      <DemoGroup title={t('devUi.names.disclosure')}>
        <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
          <Demo label={t('devUi.states.closed')}>
            <Disclosure summary={t('devUi.sample.technical')} className="text-sm">
              <p className="flex flex-col gap-1">
                <span className="font-medium">{t('devUi.sample.signingAccount')}</span>
                <AddressText address={SAMPLE.stakeJ} variant="full" />
              </p>
            </Disclosure>
          </Demo>
          <Demo label={t('devUi.states.open')}>
            <Disclosure summary={t('faq.items.second-lost.q')} variant="row" defaultOpen className="border-y border-border">
              <FaqAnswer text={t('faq.items.second-lost.a')} />
            </Disclosure>
          </Demo>
        </div>
      </DemoGroup>

      <DemoGroup title={t('devUi.names.commandBlock')}>
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          <Demo label={t('devUi.states.normal')}>
            <CommandBlock argv={COMMANDS.rescue} label={t('recovery.commands.rescue')} />
          </Demo>
          <Demo label={t('devUi.states.copied')}>
            <CommandBlock argv={COMMANDS.withdraw} label={t('recovery.commands.withdraw')} feedback="copied" />
          </Demo>
          <Demo label={t('devUi.states.error')}>
            <CommandBlock argv={LEDGER_PUBKEY_COMMAND} label={t('recovery.commands.ledger')} feedback="failed" />
          </Demo>
          <Demo label={t('devUi.states.loading')}>
            <CommandBlockSkeleton />
          </Demo>
        </div>
      </DemoGroup>

      <DemoGroup title={t('devUi.names.supportBadge')}>
        <Demo label={t('devUi.states.everyVerdict')}>
          <div className="flex flex-wrap items-center gap-2">
            {VERDICTS.map((verdict) => (
              <SupportBadge key={verdict} verdict={verdict} />
            ))}
          </div>
        </Demo>
      </DemoGroup>

      <DemoGroup title={t('devUi.names.faqItem')}>
        <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
          <Demo label={t('devUi.states.closed')}>
            <FaqItem id="dev-ui-faq-lock-ends" question={t('faq.items.lock-ends.q')}>
              <FaqAnswer text={t('faq.items.lock-ends.a', FAQ_PARAMS)} />
            </FaqItem>
          </Demo>
          <Demo label={t('devUi.states.open')}>
            <FaqItem id="dev-ui-faq-second-lost" question={t('faq.items.second-lost.q')} defaultOpen>
              <FaqAnswer text={t('faq.items.second-lost.a')} />
            </FaqItem>
          </Demo>
        </div>
      </DemoGroup>

      <DemoGroup title={t('devUi.names.errorState')}>
        <ErrorState title={t('devUi.states.error')} message={t('errors.network')} detail={SAMPLE_ERROR_DETAIL.fetch} onRetry={noop} />
      </DemoGroup>

      <DemoGroup title={t('devUi.darkPreview')} note={t('devUi.darkPreviewNote')}>
        <DarkPreview>
          <SummaryBar
            label={`${t('devUi.names.summaryBar')} · ${t('devUi.darkPreview')}`}
            state="ready"
            headline={t('devUi.sample.summaryHeadline')}
            detail={t('devUi.sample.summaryDetail')}
            monitoring={<MonitoringStatus state={health(25)} now={now} />}
            tools={<SummaryTools />}
            footer={<RescueFooter />}
          />
          <AccountList label={t('devUi.darkPreview')}>
            {rows.map((row) => (
              <AccountListItem key={row.key}>
                <SampleAccountRow row={row} defaultMoreOpen={row.key === 'protected'} />
              </AccountListItem>
            ))}
          </AccountList>
          <StepProgress steps={steps} current={2} />
          <RadioCardDemo
            legend={t('devUi.sample.newEnd')}
            options={[...([3, 6, 12] as const).map(periodOption), removeOption]}
            initial="6"
          />
          <ActionBar
            risk={<RiskNote risk="lose-second-key" date={SAMPLE_LOCK_END} variant="inline" />}
            note={t('devUi.sample.firstSigner')}
            primary={<Button>{t('devUi.sample.signTwo')}</Button>}
            secondary={<Button variant="ghost">{t('common.back')}</Button>}
          />
          <NoStakeAccounts headingLevel={3} />
        </DarkPreview>
      </DemoGroup>

      <DemoGroup title={t('devUi.names.keyList')}>
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          <Demo label={t('devUi.states.normal')}>
            <KeyList
              items={[
                { role: 'main', address: SAMPLE.mainKey, note: t('withdraw.keys.main') },
                {
                  role: 'second',
                  address: SAMPLE.secondKey,
                  note: t('withdraw.keys.second', { lock: t('status.lockedUntil', { date: formatUtcDate(SAMPLE_LOCK_END) ?? '' }) }),
                },
              ]}
            />
          </Demo>
          <Demo label={t('devUi.states.loading')}>
            <KeyListSkeleton />
          </Demo>
        </div>
      </DemoGroup>
    </DevSection>
  );
}
