import type { Address } from '@solana/kit';
import type { Cluster } from '@stakeward/core';
import { FlaskConicalIcon } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CLUSTER } from '@/config';
import { useLoad } from '@/hooks/use-load';
import { t } from '@/i18n';
import { resolveSlot, type ResolvedSlot } from '@/ports';
import { AccountSection, type AccountsData } from './AccountSection.tsx';
import { OptionsSection } from './OptionsSection.tsx';
import type { DevCosignPorts } from './ports.ts';
import type { LifetimeChoice, SigningOrder } from './report.ts';
import { ReportsSection } from './ReportsSection.tsx';
import { ResetSection } from './ResetSection.tsx';
import { RunSection } from './RunSection.tsx';
import { Section } from './shared.tsx';
import type { ConfirmOptions } from './SigningRun.tsx';
import { SlotsSection, type DevSlot } from './SlotsSection.tsx';
import { readNonceInfo } from './tasks.ts';

export type DevCosignProps = DevCosignPorts & {
  cluster?: Cluster | undefined;
  confirmOptions?: ConfirmOptions | undefined;
  /** Report timestamps; tests pass a fixed clock. */
  now?: (() => Date) | undefined;
};

/**
 * /dev/cosign (devnet only): the wallet matrix of CLAUDE.md section 10, step 3. Two wallets (Main key A, Second key K)
 * sign ONE SetLockupChecked on a stake account of A, by blockhash or durable nonce, in either order. The page shows
 * whether each wallet changed the message and how, sends it, re-reads the account and writes a plain-text report.
 */
export function DevCosign({ chain, wallets: registry, slots, reports, cluster = CLUSTER, confirmOptions, now = defaultNow }: DevCosignProps) {
  const wallets = useSyncExternalStore(registry.subscribe, registry.getSnapshot);
  const slotState = useSyncExternalStore(slots.subscribe, slots.getSnapshot);
  const main = installed(resolveSlot(slotState.main, wallets));
  const second = installed(resolveSlot(slotState.second, wallets));
  const mainKey = main?.slot.address ?? null;
  const secondKey = second?.slot.address ?? null;

  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<Address | null>(null);
  const [lifetime, setLifetime] = useState<LifetimeChoice>('blockhash');
  const [order, setOrder] = useState<SigningOrder>('main-first');
  const [busy, setBusy] = useState(false);
  const bump = () => {
    setRefresh((value) => value + 1);
  };

  const accounts = useLoad<AccountsData>(mainKey === null ? null : `${mainKey}:${String(refresh)}`, async () => {
    if (mainKey === null) throw new Error('No main key');
    const [found, clock] = await Promise.all([chain.findStakeAccounts({ withdrawer: mainKey }), chain.getClock()]);
    return { accounts: found.accounts, clock };
  });
  const nonce = useLoad(mainKey === null || lifetime !== 'nonce' ? null : `${mainKey}:${String(refresh)}`, () => {
    if (mainKey === null) throw new Error('No main key');
    return readNonceInfo(chain, mainKey);
  });

  const ready = accounts.status === 'ready' ? accounts.value : null;
  const account = ready?.accounts.find((candidate) => candidate.address === selected) ?? null;
  const clock = ready?.clock ?? null;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold">{t('devCosign.title')}</h1>
        <p className="text-muted">{t('devCosign.intro')}</p>
        <Alert tone="info" role="note">
          <FlaskConicalIcon aria-hidden="true" />
          <AlertDescription className="text-foreground">{t('devCosign.devnetOnly')}</AlertDescription>
        </Alert>
      </header>
      <Section id="wallets" title={t('devCosign.sections.wallets')} intro={t('devCosign.sections.walletsIntro')}>
        <SlotsSection wallets={wallets} slots={slots} main={main} second={second} />
      </Section>
      <Section id="account" title={t('devCosign.sections.account')} intro={t('devCosign.sections.accountIntro')}>
        <AccountSection
          mainKey={mainKey}
          secondKey={secondKey}
          data={accounts}
          selected={account?.address ?? null}
          onSelect={setSelected}
          onRefresh={bump}
        />
      </Section>
      <Section id="options" title={t('devCosign.sections.options')}>
        <OptionsSection
          chain={chain}
          confirmOptions={confirmOptions}
          lifetime={lifetime}
          onLifetime={setLifetime}
          order={order}
          onOrder={setOrder}
          main={main}
          nonce={nonce}
          busy={busy}
          onBusy={setBusy}
          onRefresh={bump}
        />
      </Section>
      <Section id="run" title={t('devCosign.sections.run')} intro={t('devCosign.sections.runIntro')}>
        <RunSection
          chain={chain}
          cluster={cluster}
          confirmOptions={confirmOptions}
          now={now}
          main={main}
          second={second}
          account={account}
          clock={clock}
          lifetime={lifetime}
          order={order}
          nonceReady={nonce.status === 'ready' && nonce.value.state.kind === 'ready'}
          busy={busy}
          onBusy={setBusy}
          reports={reports}
          onRefresh={bump}
        />
      </Section>
      <Section id="reset" title={t('devCosign.sections.reset')} intro={t('devCosign.sections.resetIntro')}>
        <ResetSection
          chain={chain}
          confirmOptions={confirmOptions}
          main={main}
          second={second}
          account={account}
          clock={clock}
          busy={busy}
          onBusy={setBusy}
          onRefresh={bump}
        />
      </Section>
      <Section id="reports" title={t('devCosign.sections.reports')} intro={t('devCosign.sections.reportsIntro')}>
        <ReportsSection reports={reports} />
      </Section>
    </div>
  );
}

function defaultNow(): Date {
  return new Date();
}

/** A slot whose wallet is installed here; one whose wallet is gone counts as empty. */
function installed(slot: ResolvedSlot | null): DevSlot | null {
  if (slot === null) return null;
  const { wallet } = slot;
  return wallet === null ? null : { ...slot, wallet };
}
