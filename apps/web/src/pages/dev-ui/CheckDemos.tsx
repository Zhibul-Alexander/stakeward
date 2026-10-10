import { setupCheck, type ClockView } from '@stakeward/core';
import { useState } from 'react';
import type { WatchedAccount } from '@/api/accounts';
import { AlertExplanation } from '@/components/product/alert-explanation';
import { ProtectionCheck, type ProtectionCheckLinks } from '@/components/product/protection-check';
import { t } from '@/i18n';
import { appLinks } from '@/pages/app/view';
import { telegramLinkPath } from '@/api/telegram';
import { Demo, DemoGroup } from './layout.tsx';
import { SAMPLE, SAMPLE_ERROR_DETAIL, SAMPLE_LOCK_END, sampleRows } from './samples.ts';

const noop = () => undefined;

const LINKS: ProtectionCheckLinks = {
  protect: appLinks.protect,
  extend: appLinks.extend,
  rescue: appLinks.rescue(SAMPLE.mainKey),
  rescueKit: '/rescue-kit',
  telegram: telegramLinkPath(SAMPLE.mainKey),
  recovery: appLinks.recovery,
};

/** ProtectionCheck (D125) in every state: with fixes to make, all passing, loading, empty and error. */
export function ProtectionCheckDemos({ clock }: { clock: ClockView }) {
  const [results] = useState(() => {
    const accounts = sampleRows(clock).map((row) => row.account);
    const mixed = setupCheck({
      mainKey: SAMPLE.mainKey,
      accounts,
      clock,
      knownSecondKeys: [SAMPLE.secondKey],
      rescueKits: { [SAMPLE.stakeA]: 'ready' },
    });
    const good = accounts.filter((account) => account.address === SAMPLE.stakeA);
    const allPass = setupCheck({
      mainKey: SAMPLE.mainKey,
      accounts: good,
      clock,
      knownSecondKeys: [SAMPLE.secondKey],
      rescueKits: { [SAMPLE.stakeA]: 'ready' },
    });
    const empty = setupCheck({ mainKey: SAMPLE.mainKey, accounts: [], clock, knownSecondKeys: [], rescueKits: {} });
    return { mixed, allPass, empty };
  });
  return (
    <DemoGroup title={t('devUi.names.protectionCheck')}>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Demo label={t('devUi.states.normal')}>
          <ProtectionCheck state="ready" result={results.mixed} links={LINKS} />
        </Demo>
        <Demo label={t('devUi.states.allPass')}>
          <ProtectionCheck state="ready" result={results.allPass} links={LINKS} />
        </Demo>
        <Demo label={t('devUi.states.loading')}>
          <ProtectionCheck state="loading" />
        </Demo>
        <Demo label={t('devUi.states.empty')}>
          <ProtectionCheck state="ready" result={results.empty} links={LINKS} />
        </Demo>
        <Demo label={t('devUi.states.error')}>
          <ProtectionCheck state="error" message={t('errors.network')} detail={SAMPLE_ERROR_DETAIL.rpc} onRetry={noop} />
        </Demo>
      </div>
    </DemoGroup>
  );
}

const SAMPLE_WATCHED: WatchedAccount = {
  address: SAMPLE.stakeA,
  roles: ['main'],
  lockUntil: SAMPLE_LOCK_END,
  lock: 'in-force',
  daysLeft: 183,
  lamports: 1_250_500_000_000n,
  state: 'delegated',
};

/** AlertExplanation (D125): opened from an alert with earlier changes, loading, with none recorded, and error. */
export function AlertExplanationDemos() {
  const [seen] = useState(() => new Date(Date.now() - 25 * 60_000));
  const recent = [{ stakeAccount: SAMPLE.stakeA, type: 'DELEGATION_CHANGED', detectedAt: new Date(seen.getTime() - 2 * 86_400_000) }];
  return (
    <DemoGroup title={t('devUi.names.alertExplanation')}>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Demo label={t('devUi.states.fromAlert')}>
          <AlertExplanation state="ready" event="DEACTIVATED" stake={SAMPLE.stakeA} detectedAt={seen} current={SAMPLE_WATCHED} recent={recent} />
        </Demo>
        <Demo label={t('devUi.states.loading')}>
          <AlertExplanation state="loading" event="STAKER_CHANGED" stake={SAMPLE.stakeA} />
        </Demo>
        <Demo label={t('devUi.states.empty')}>
          <AlertExplanation state="ready" event="REMINDER_7" stake={SAMPLE.stakeB} detectedAt={null} current={null} recent={[]} />
        </Demo>
        <Demo label={t('devUi.states.error')}>
          <AlertExplanation state="error" event="LOCKUP_CHANGED" stake={SAMPLE.stakeA} detail={SAMPLE_ERROR_DETAIL.rpc} onRetry={noop} />
        </Demo>
      </div>
    </DemoGroup>
  );
}
