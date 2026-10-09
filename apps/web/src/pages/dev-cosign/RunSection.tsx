import type { Address } from '@solana/kit';
import {
  decodeStakeAccount,
  isLockupInForce,
  shortAddress,
  validateSecondKey,
  type ChainClock,
  type ChainPort,
  type Cluster,
  type StakeAccount,
} from '@stakeward/core';
import { CircleCheckIcon, CircleDashedIcon, PlayIcon, TriangleAlertIcon } from 'lucide-react';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { formatReport, type LifetimeChoice, type ReportStore, type RunReport, type SigningOrder } from './report.ts';
import { formatUtcDateTime, ReportBlock } from './shared.tsx';
import type { ConfirmOptions, Signer } from './SigningRun.tsx';
import type { DevSlot } from './SlotsSection.tsx';
import { buildProtect } from './tasks.ts';
import { TaskRunner, type Prepared } from './TaskRunner.tsx';

type RunSectionProps = {
  chain: ChainPort;
  cluster: Cluster;
  confirmOptions?: ConfirmOptions | undefined;
  now: () => Date;
  main: DevSlot | null;
  second: DevSlot | null;
  account: StakeAccount | null;
  clock: ChainClock | null;
  lifetime: LifetimeChoice;
  order: SigningOrder;
  nonceReady: boolean;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  reports: ReportStore;
  onRefresh: () => void;
};

/** What a run uses, fixed when it starts: later slot or account changes do not touch it. */
type RunTask = {
  id: number;
  main: Signer;
  second: Signer;
  account: StakeAccount;
  clock: ChainClock;
  order: SigningOrder;
  lifetime: LifetimeChoice;
};

type ProtectPrepared = Prepared & {
  lockUntil: bigint;
  stakeAccount: Address;
  secondKey: Address;
  order: SigningOrder;
  lifetime: LifetimeChoice;
};

/**
 * Step 4: one SetLockupChecked signed by both wallets in the chosen order, sent and re-read, and its report
 * (CLAUDE.md section 10, step 3).
 */
export function RunSection(props: RunSectionProps) {
  const { chain } = props;
  const [task, setTask] = useState<RunTask | null>(null);
  const missing = missingFor(props);

  function start() {
    const { main, second, account, clock } = props;
    if (main === null || second === null || account === null || clock === null) return;
    setTask((previous) => ({
      id: (previous?.id ?? 0) + 1,
      main: { role: 'main', wallet: main.wallet, address: main.slot.address },
      second: { role: 'second', wallet: second.wallet, address: second.slot.address },
      account,
      clock,
      order: props.order,
      lifetime: props.lifetime,
    }));
    props.onBusy(true);
  }

  if (task !== null) {
    const { main, second, account, clock, order, lifetime } = task;
    return (
      <TaskRunner<ProtectPrepared>
        key={task.id}
        chain={chain}
        knownRoles={{ main: main.address, second: second.address }}
        confirmOptions={props.confirmOptions}
        closeLabel={t('devCosign.run.newRun')}
        build={async () => {
          const { built, lockUntil } = await buildProtect(chain, {
            stakeAccount: account.address,
            mainKey: main.address,
            secondKey: second.address,
            lifetime,
            cluster: props.cluster,
          });
          return {
            built,
            lockUntil,
            stakeAccount: account.address,
            secondKey: second.address,
            order,
            lifetime,
            signers: order === 'main-first' ? [main, second] : [second, main],
            current: { lockup: account.lockup, clock },
          };
        }}
        onFinished={async (result, prepared) => {
          let lockupAfter: RunReport['lockupAfter'] = null;
          if (result.send?.kind === 'confirmed') {
            try {
              const { accounts } = await chain.getAccounts([prepared.stakeAccount]);
              const raw = accounts[0] ?? null;
              const decoded = raw === null ? null : decodeStakeAccount(raw);
              if (decoded?.ok === true) {
                const { lockup } = decoded.account;
                lockupAfter = {
                  secondKey: lockup.custodian,
                  unixTimestamp: lockup.unixTimestamp,
                  asExpected: lockup.custodian === prepared.secondKey && lockup.unixTimestamp === prepared.lockUntil,
                };
              }
            } catch {
              // The report says nothing about the lock; the account list below shows it after a refresh.
            }
          }
          const text = formatReport({
            ...result,
            date: props.now(),
            cluster: props.cluster,
            stakeAccount: prepared.stakeAccount,
            order: prepared.order,
            lifetime: prepared.lifetime,
            lockupAfter,
          });
          props.reports.add(text);
          props.onBusy(false);
          props.onRefresh();
          return <RunResult lockupAfter={lockupAfter} text={text} />;
        }}
        onClose={() => {
          setTask(null);
          props.onBusy(false);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {missing.length === 0 ? (
        <p className="text-sm">{t('devCosign.run.readyText')}</p>
      ) : (
        <ul aria-label={t('devCosign.run.missingLabel')} className="flex flex-col gap-2 text-sm">
          {missing.map((text) => (
            <li key={text} className="flex items-start gap-2">
              <CircleDashedIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted" />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button disabled={missing.length > 0} onClick={start}>
          <PlayIcon aria-hidden="true" />
          {t('devCosign.run.start')}
        </Button>
      </div>
    </div>
  );
}

/** Everything that keeps the run from starting, in words; empty when it can start. */
function missingFor(props: RunSectionProps): string[] {
  const { main, second, account, clock } = props;
  const missing: string[] = [];
  if (main === null) missing.push(t('devCosign.run.needMain'));
  if (second === null) missing.push(t('devCosign.run.needSecond'));
  if (account === null || clock === null) missing.push(t('devCosign.run.needAccount'));
  else if (main !== null) {
    const { lockup } = account;
    if (isLockupInForce(lockup, clock) && lockup.custodian !== main.slot.address) {
      missing.push(t('devCosign.run.needUnlocked', { until: formatUtcDateTime(lockup.unixTimestamp), key: shortAddress(lockup.custodian) }));
    }
    if (second !== null) {
      for (const violation of validateSecondKey({
        second: second.slot.address,
        mainKey: main.slot.address,
        staker: account.staker,
        stakeAccount: account.address,
      })) {
        missing.push(t(`devCosign.run.secondKeyRule.${violation}`));
      }
    }
  }
  if (props.lifetime === 'nonce' && !props.nonceReady) missing.push(t('devCosign.run.needNonce'));
  if (props.busy) missing.push(t('devCosign.run.needIdle'));
  return missing;
}

function RunResult({ lockupAfter, text }: { lockupAfter: RunReport['lockupAfter']; text: string }) {
  return (
    <div className="flex flex-col gap-4">
      {lockupAfter === null ? null : (
        <Alert tone={lockupAfter.asExpected ? 'success' : 'warning'} data-lock-after={lockupAfter.asExpected ? 'expected' : 'unexpected'}>
          {lockupAfter.asExpected ? <CircleCheckIcon aria-hidden="true" /> : <TriangleAlertIcon aria-hidden="true" />}
          <AlertDescription className="text-foreground">
            {t(lockupAfter.asExpected ? 'devCosign.run.lockSet' : 'devCosign.run.lockUnexpected', {
              key: shortAddress(lockupAfter.secondKey),
              until: formatUtcDateTime(lockupAfter.unixTimestamp),
            })}
          </AlertDescription>
        </Alert>
      )}
      <ReportBlock text={text} label={t('devCosign.reports.thisRun')} />
    </div>
  );
}
