import { epochEndEstimate, formatSol, isLockupInForce } from '@stakeward/core';
import { RefreshCwIcon, TriangleAlertIcon } from 'lucide-react';
import { useId, type ReactNode, type Ref } from 'react';
import { Link } from 'wouter';
import { AddressText } from '@/components/product/address-text';
import { Countdown, formatRemaining } from '@/components/product/countdown';
import { RiskNote } from '@/components/product/risk-note';
import { lockText } from '@/components/product/transaction-summary';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { t } from '@/i18n';
import type { LoadedAccount } from '@/pages/account/AccountView';
import { appLinks } from '@/pages/app/view';
import { withdrawStage } from './stage.ts';
import type { WithdrawWhat } from './WithdrawSigning.tsx';

type StageBlockProps = {
  headingRef: Ref<HTMLHeadingElement>;
  loaded: LoadedAccount;
  onSign: (what: WithdrawWhat) => void;
  /** Read the account again (Check again). */
  onCheckAgain: () => void;
  /** The countdown ran out: read the account again (the page throttles it). */
  onCountdownEnd: () => void;
};

/** The withdrawal stage title shown on the stage block and kept as the signing section's heading. */
export function withdrawTitle(what: WithdrawWhat, lamports: bigint): string {
  return what === 'withdraw' ? t('withdraw.ready.title', { amount: formatSol(lamports) }) : t('withdraw.deactivate.title');
}

/**
 * What /withdraw/:account offers for the account as just read (F3): stop staking first, wait for the epoch to end,
 * or withdraw; or why it cannot (another key manages staking, a lock no second key holds). One main action at a time
 * (UX rule 2).
 */
export function StageBlock({ headingRef, loaded, onSign, onCheckAgain, onCountdownEnd }: StageBlockProps) {
  const headingId = useId();
  // Epoch ends are estimated from the device clock at the read: the countdown ticks on the device clock.
  const { account, clock, epoch, readAt: nowSec } = loaded;
  const heading = (text: string) => (
    <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-2xl font-semibold">
      {text}
    </h2>
  );
  switch (withdrawStage(account, clock)) {
    case 'deactivate': {
      const left = epochEndEstimate(epoch, nowSec) - nowSec;
      return (
        <Stage headingId={headingId}>
          {heading(withdrawTitle('deactivate', account.lamports))}
          <p className="max-w-prose">{t('withdraw.deactivate.body', { time: formatRemaining(Number(left), true) })}</p>
          <div>
            <Button
              onClick={() => {
                onSign('deactivate');
              }}
            >
              {t('withdraw.deactivate.action')}
            </Button>
          </div>
        </Stage>
      );
    }
    case 'service-staker':
      return (
        <Alert tone="warning" role="note">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription className="flex flex-col gap-2 text-foreground">
            <p className="font-medium">{t('withdraw.serviceStaker')}</p>
            <AddressText address={account.staker} variant="full" />
          </AlertDescription>
        </Alert>
      );
    case 'deactivating': {
      const until = account.delegation?.deactivationEpoch ?? epoch.epoch;
      return (
        <Stage headingId={headingId}>
          {heading(t('withdraw.deactivating.title'))}
          <Countdown
            to={epochEndEstimate(epoch, nowSec, until)}
            label={t('withdraw.deactivating.label')}
            onEnd={onCountdownEnd}
          />
          <p className="max-w-prose text-sm text-muted">{t('withdraw.deactivating.body')}</p>
          <div>
            <Button variant="outline" onClick={onCheckAgain}>
              <RefreshCwIcon aria-hidden="true" />
              {t('common.checkAgain')}
            </Button>
          </div>
        </Stage>
      );
    }
    case 'withdraw': {
      const { lockup } = account;
      const inForce = isLockupInForce(lockup, clock);
      return (
        <div className="flex flex-col gap-6">
          <Stage headingId={headingId}>
            {heading(withdrawTitle('withdraw', account.lamports))}
            <Line text={t('withdraw.ready.mainKey')}>
              <AddressText address={account.withdrawer} variant="full" />
            </Line>
            {inForce ? (
              <>
                <Line text={t('withdraw.ready.secondSigns', { lock: lockText(lockup, clock) })}>
                  <AddressText address={lockup.custodian} variant="full" />
                </Line>
                <p className="max-w-prose text-sm text-muted">{t('withdraw.desktop')}</p>
              </>
            ) : (
              <p className="max-w-prose">{t('withdraw.ready.mainAlone')}</p>
            )}
            <div>
              <Button
                onClick={() => {
                  onSign('withdraw');
                }}
              >
                {t('withdraw.ready.action')}
              </Button>
            </div>
          </Stage>
          {/* F3.4: the second key lifts the lock alone, then the main key withdraws alone. Not for a lock an epoch
              holds: removing the date would not end it. */}
          {inForce && lockup.epoch <= clock.epoch ? (
            <Card>
              <CardHeader>
                <CardTitle asChild>
                  <h3>{t('withdraw.fallback.title')}</h3>
                </CardTitle>
                <CardDescription>{t('withdraw.fallback.body')}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <RiskNote risk="unlock-opens-window" tone="danger" />
                <div>
                  <Button asChild variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal">
                    <Link href={`${appLinks.extend(account.address)}?remove`}>{t('withdraw.fallback.action')}</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      );
    }
    case 'unsupported-lock':
      return (
        <Alert tone="warning" role="note">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription className="text-foreground">
            <p className="font-medium">{t('withdraw.unsupportedLock')}</p>
          </AlertDescription>
        </Alert>
      );
  }
}

function Stage({ headingId, children }: { headingId: string; children: ReactNode }) {
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      {children}
    </section>
  );
}

/** A sentence followed by the full address it names (UX rule 9: full on the screens that lead to a signature). */
function Line({ text, children }: { text: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="max-w-prose">{text}</p>
      {children}
    </div>
  );
}
