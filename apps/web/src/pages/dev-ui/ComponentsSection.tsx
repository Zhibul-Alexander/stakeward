import { LEDGER_PUBKEY_COMMAND, recoveryCommands, U64_MAX } from '@stakeward/core';
import { useEffect, useState } from 'react';
import { AccountRow, AccountRowError, AccountRowSkeleton } from '@/components/product/account-row';
import { AddressText, AddressTextSkeleton } from '@/components/product/address-text';
import { CommandBlock, CommandBlockSkeleton } from '@/components/product/command-block';
import { Countdown, CountdownSkeleton } from '@/components/product/countdown';
import { NoStakeAccounts } from '@/components/product/empty-state';
import { ErrorState } from '@/components/product/error-state';
import { JobStatusList } from '@/components/product/job-status-list';
import { LinkCard } from '@/components/product/link-card';
import { QrCode } from '@/components/product/qr-code';
import { RiskNote } from '@/components/product/risk-note';
import { SignerList, SignerListSkeleton } from '@/components/product/signer-list';
import { SolAmount, SolAmountSkeleton } from '@/components/product/sol-amount';
import { StatusBadge, StatusBadgeSkeleton, statusLabel, type StatusBadgeStatus } from '@/components/product/status-badge';
import { StepProgress } from '@/components/product/step-progress';
import {
  TransactionSummary,
  TransactionSummaryError,
  TransactionSummarySkeleton,
} from '@/components/product/transaction-summary';
import { WalletSlot } from '@/components/product/wallet-slot';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/i18n';
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

/** The action buttons a row would have on /app for its status. */
function rowActions(row: SampleRow) {
  if (row.protection === 'unprotected') {
    return (
      <>
        <Checkbox aria-label={t('devUi.sample.protect')} />
        <Button size="sm">{t('devUi.sample.protect')}</Button>
      </>
    );
  }
  if (row.protection === 'locked-by-other') return undefined;
  return (
    <>
      <Button size="sm" variant="outline">
        {t('devUi.sample.extend')}
      </Button>
      <Button size="sm" variant="outline">
        {t('devUi.sample.withdraw')}
      </Button>
      <Button size="sm" variant="ghost">
        {t('devUi.sample.rescue')}
      </Button>
    </>
  );
}

function rowLabel(row: SampleRow): string {
  return row.key === 'managed-by-service' ? t('devUi.states.managedByService') : statusLabel(row.key);
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

      <DemoGroup title={t('devUi.names.commandBlock')}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Demo label={t('devUi.states.normal')}>
            <CommandBlock
              argv={recoveryCommands({ mainKeyAddress: SAMPLE.mainKey, url: 'mainnet-beta' }).withdraw.map((token) =>
                token === '<STAKE_ACCOUNT>' ? SAMPLE.stakeA : token,
              )}
              label={t('devUi.commandSampleLabel')}
            />
          </Demo>
          <Demo label={t('devUi.states.oneLine')}>
            <CommandBlock argv={LEDGER_PUBKEY_COMMAND} label={t('recovery.commands.ledger')} />
          </Demo>
          <Demo label={t('devUi.states.loading')}>
            <CommandBlockSkeleton />
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
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {rows.map((row) => (
            <Demo key={row.key} label={rowLabel(row)}>
              <AccountRow
                account={row.account}
                activation={row.activation}
                protection={row.protection}
                managedByService={row.managedByService}
                wasProtected={row.wasProtected}
                actions={rowActions(row)}
              />
            </Demo>
          ))}
          <Demo label={t('devUi.states.loading')}>
            <AccountRowSkeleton />
          </Demo>
          <Demo label={t('devUi.states.error')}>
            <AccountRowError address={SAMPLE.stakeB} detail={SAMPLE_ERROR_DETAIL.rpc} onRetry={noop} />
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

      <DemoGroup title={t('devUi.names.stepProgress')}>
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
        </div>
      </DemoGroup>

      <DemoGroup title={t('devUi.names.errorState')}>
        <ErrorState title={t('devUi.states.error')} message={t('errors.network')} detail={SAMPLE_ERROR_DETAIL.fetch} onRetry={noop} />
      </DemoGroup>
    </DevSection>
  );
}
