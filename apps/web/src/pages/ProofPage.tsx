import type { Address } from '@solana/kit';
import { aiPrompt, buildProof, formatSol, formatUtcDate, type Cluster, type ProofView } from '@stakeward/core';
import { InfoIcon, LoaderCircleIcon, RefreshCwIcon, SearchXIcon, ShieldCheckIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'wouter';
import { fetchHealth, type Health } from '@/api/health';
import { Page } from '@/components/layout/Page';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { AccountList, AccountListItem, AccountListSkeleton, AccountRow } from '@/components/product/account-row';
import { AddressText } from '@/components/product/address-text';
import { AskAi } from '@/components/product/ask-ai';
import { EmptyState } from '@/components/product/empty-state';
import { ErrorState } from '@/components/product/error-state';
import { SummaryBar } from '@/components/product/summary-bar';
import { Button } from '@/components/ui/button';
import { CLUSTER } from '@/config';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { usePorts } from '@/ports';
import { isCheckableAddress } from './app/AddressForm.tsx';
import { useHealth, useNow, useStakeAccounts } from './app/hooks.ts';
import { MonitoringStatus } from './app/MonitoringStatus.tsx';

/** "Last checked N min ago" moves on while the page is open, as on /app. */
const CLOCK_TICK_MS = 30_000;

/** A SOL amount without its unit, for sentences that say "SOL" once. */
const solNumber = (lamports: bigint) => formatSol(lamports).replace(/ SOL$/, '');

const loadHealthFromWorker = () => fetchHealth();

type ProofPageProps = {
  /** GET /api/health; tests pass their own. */
  loadHealth?: (() => Promise<Health>) | undefined;
};

/**
 * /proof/:wallet (DECISIONS.md D124): a public, read-only page a fund, a DAO treasury or a validator shares to show
 * that its native stake is locked. Everything is read from the network on each visit, as /app?address= reads it
 * (stake accounts whose main key is the wallet, the Clock sysvar); nothing is stored and no wallet is asked for. The
 * network cannot say who holds a second key (D14), so a lock reads "Locked by a second key" with that key's address,
 * never Protected, and the page says so.
 */
export function ProofPage({ loadHealth = loadHealthFromWorker }: ProofPageProps) {
  const params = useParams<{ wallet: string }>();
  const wallet = params.wallet;
  return (
    <Page width="app">
      <PageHeader title={t('proof.title')} lead={t('proof.intro')} />
      {isCheckableAddress(wallet) ? (
        <ProofResults key={wallet} wallet={wallet} loadHealth={loadHealth} />
      ) : (
        <EmptyState icon={SearchXIcon} title={t('proof.invalidTitle')} action={<CheckAnotherLink />}>
          <p>{t('proof.invalidBody')}</p>
        </EmptyState>
      )}
    </Page>
  );
}

function CheckAnotherLink() {
  return (
    <Button asChild variant="outline">
      <Link href="/app">{t('proof.emptyAction')}</Link>
    </Button>
  );
}

function ProofResults({ wallet, loadHealth }: { wallet: Address; loadHealth: () => Promise<Health> }) {
  const { chain } = usePorts();
  const [attempt, setAttempt] = useState(0);
  const state = useStakeAccounts(chain, wallet, attempt, 'main');
  const health = useHealth(loadHealth, attempt);
  const now = useNow(CLOCK_TICK_MS);
  const reload = () => {
    setAttempt((value) => value + 1);
  };
  const proof = useMemo(
    () => (state.status === 'ready' ? buildProof(wallet, state.data.accounts, state.data.clock) : null),
    [wallet, state],
  );
  const clock = state.status === 'ready' ? state.data.clock : null;

  return (
    <div data-slot="proof-results" className="flex flex-col gap-6 sm:gap-8">
      <p role="status" className="sr-only">
        {proof === null ? '' : t('proof.announce', { count: proof.totals.count })}
      </p>
      <p className="flex flex-wrap items-center gap-x-1.5 text-sm">
        <span className="text-muted">{t('proof.wallet')}</span>
        <AddressText address={wallet} />
      </p>
      <SummaryBar
        label={t('proof.summaryLabel')}
        state={state.status}
        headline={
          proof === null || proof.totals.count === 0
            ? undefined
            : t('proof.headline', { locked: solNumber(proof.totals.lockedLamports), total: solNumber(proof.totals.lamports) })
        }
        detail={proof === null || proof.totals.count === 0 ? undefined : <SummaryDetail proof={proof} />}
        monitoring={<MonitoringStatus state={health} now={now} />}
        tools={
          <Button variant="ghost" size="icon-sm" aria-label={t('proof.refresh')} onClick={reload}>
            <RefreshCwIcon aria-hidden="true" />
          </Button>
        }
      />
      {state.status === 'loading' ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            {t('proof.loading')}
          </p>
          <AccountListSkeleton rows={3} />
        </div>
      ) : state.status === 'error' ? (
        <ErrorState title={t('proof.errorTitle')} message={errorMessage(state.error)} detail={state.error.detail} onRetry={reload} />
      ) : proof === null || clock === null ? null : proof.totals.count === 0 ? (
        <EmptyState title={t('proof.emptyTitle')} action={<CheckAnotherLink />}>
          <p>{t('proof.emptyBody')}</p>
        </EmptyState>
      ) : (
        <>
          <Section title={t('proof.listTitle')} description={t('proof.listNote')}>
            <AccountList label={t('proof.listTitle')}>
              {proof.rows.map((row) => (
                <AccountListItem key={row.account.address}>
                  <AccountRow
                    account={row.account}
                    activation={row.activation}
                    clock={clock}
                    protection={row.protection}
                    managedByService={row.managedByService}
                    secondKeyKnown={false}
                    hint={false}
                  />
                </AccountListItem>
              ))}
            </AccountList>
          </Section>
          <AskAi prompt={proofPrompt(proof, CLUSTER)} />
        </>
      )}
      <div data-slot="proof-notes" className="flex flex-col gap-2 text-sm text-pretty">
        <p className="flex items-start gap-2">
          <ShieldCheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted" />
          {t('proof.fresh')}
        </p>
        <p className="flex items-start gap-2">
          <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted" />
          {t('proof.limits')}
        </p>
        <p className="flex items-start gap-2 text-muted">
          <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t('proof.whoHolds')}
        </p>
      </div>
    </div>
  );
}

function SummaryDetail({ proof }: { proof: ProofView }) {
  const { count, lockedCount } = proof.totals;
  const end = proof.earliestLockEnd === null ? null : formatUtcDate(proof.earliestLockEnd);
  return (
    <>
      <p>{count === 1 ? t('proof.accountsOne', { locked: lockedCount }) : t('proof.accounts', { locked: lockedCount, count })}</p>
      {end === null ? null : <p>{t('proof.earliestEnd', { date: end })}</p>}
    </>
  );
}

/** The "Ask your AI" question (D122): the totals and each account's lock, public chain data only. */
export function proofPrompt(proof: ProofView, cluster: Cluster): string {
  const { totals } = proof;
  const end = proof.earliestLockEnd === null ? null : formatUtcDate(proof.earliestLockEnd);
  const facts: [string, string][] = [
    [t('proof.ai.wallet'), proof.wallet],
    [t('proof.ai.network'), cluster],
    [t('proof.ai.solLocked'), t('proof.ai.ofTotal', { part: formatSol(totals.lockedLamports), total: formatSol(totals.lamports) })],
    [t('proof.ai.accountsLocked'), t('proof.ai.ofTotal', { part: totals.lockedCount, total: totals.count })],
    [t('proof.ai.earliestEnd'), end ?? t('proof.ai.none')],
  ];
  for (const row of proof.rows) {
    const amount = formatSol(row.account.lamports);
    const key = row.account.lockup.custodian;
    const date = row.lockEnd === null ? null : formatUtcDate(row.lockEnd);
    facts.push([
      t('proof.ai.account', { address: row.account.address }),
      !row.locked
        ? t('proof.ai.notLocked', { amount })
        : date === null
          ? t('proof.ai.lockedNoDate', { amount, key })
          : t('proof.ai.lockedUntil', { amount, date, key }),
    ]);
  }
  return aiPrompt({
    task: t('proof.ai.task'),
    facts,
    verdict: `${t('proof.headline', { locked: solNumber(totals.lockedLamports), total: solNumber(totals.lamports) })}. ${t('proof.limits')} ${t('proof.whoHolds')}`,
  });
}
