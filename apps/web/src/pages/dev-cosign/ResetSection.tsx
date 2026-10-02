import { isLockupInForce, shortAddress, type ChainClock, type ChainPort, type StakeAccount } from '@stakeward/core';
import { LockOpenIcon } from 'lucide-react';
import { useState } from 'react';
import { Countdown } from '@/components/product/countdown';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { formatUtcDateTime } from './shared.tsx';
import type { ConfirmOptions, Signer } from './SigningRun.tsx';
import type { DevSlot } from './SlotsSection.tsx';
import { buildUnlock } from './tasks.ts';
import { TaskRunner } from './TaskRunner.tsx';

type ResetSectionProps = {
  chain: ChainPort;
  confirmOptions?: ConfirmOptions | undefined;
  main: DevSlot | null;
  second: DevSlot | null;
  account: StakeAccount | null;
  clock: ChainClock | null;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onRefresh: () => void;
};

type UnlockTask = { id: number; main: Signer; second: Signer; account: StakeAccount; clock: ChainClock };

/**
 * Step 5: lift the dev lock early so the same stake account serves the next run. The second key signs SetLockup with
 * unix timestamp 0 and pays; without SOL on it, the main key pays and co-signs (F5). The lock also ends by itself.
 */
export function ResetSection({ chain, confirmOptions, main, second, account, clock, busy, onBusy, onRefresh }: ResetSectionProps) {
  const [task, setTask] = useState<UnlockTask | null>(null);

  if (task !== null) {
    return (
      <TaskRunner
        key={task.id}
        chain={chain}
        knownRoles={{ main: task.main.address, second: task.second.address }}
        confirmOptions={confirmOptions}
        closeLabel={t('common.close')}
        build={async () => {
          const { built, feePayer } = await buildUnlock(chain, {
            stakeAccount: task.account.address,
            mainKey: task.main.address,
            secondKey: task.second.address,
          });
          return {
            built,
            signers: feePayer === 'second' ? [task.second] : [task.main, task.second],
            current: { lockup: task.account.lockup, clock: task.clock },
            note: feePayer === 'second' ? undefined : t('devCosign.reset.mainPays'),
          };
        }}
        onFinished={() => {
          onBusy(false);
          onRefresh();
          return Promise.resolve(null);
        }}
        onClose={() => {
          setTask(null);
          onBusy(false);
        }}
      />
    );
  }

  if (account === null || clock === null) return <p className="text-sm text-muted">{t('devCosign.reset.chooseAccount')}</p>;
  const { lockup } = account;
  if (!isLockupInForce(lockup, clock)) return <p className="text-sm">{t('devCosign.reset.noLock')}</p>;
  if (main !== null && lockup.custodian === main.slot.address) return <p className="text-sm">{t('devCosign.reset.mainHolds')}</p>;

  const until = formatUtcDateTime(lockup.unixTimestamp);
  const ownSecond = second !== null && lockup.custodian === second.slot.address;
  return (
    <div className="flex flex-col gap-4">
      <Countdown to={lockup.unixTimestamp} label={t('devCosign.reset.endsIn')} />
      {ownSecond && main !== null ? (
        <>
          <p className="text-sm">{t('devCosign.reset.canUnlock', { until })}</p>
          <div>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setTask((previous) => ({
                  id: (previous?.id ?? 0) + 1,
                  main: { role: 'main', wallet: main.wallet, address: main.slot.address },
                  second: { role: 'second', wallet: second.wallet, address: second.slot.address },
                  account,
                  clock,
                }));
                onBusy(true);
              }}
            >
              <LockOpenIcon aria-hidden="true" />
              {t('devCosign.reset.unlock')}
            </Button>
          </div>
          {busy ? <p className="text-sm text-muted">{t('devCosign.run.needIdle')}</p> : null}
        </>
      ) : (
        <p className="text-sm">{t('devCosign.reset.otherKey', { key: shortAddress(lockup.custodian), until })}</p>
      )}
    </div>
  );
}
