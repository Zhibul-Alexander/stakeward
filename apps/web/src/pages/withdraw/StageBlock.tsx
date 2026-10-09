import type { Address } from '@solana/kit';
import { epochEndEstimate, formatSol, isLockupInForce, slotMsEstimate, stakeActivationStatus } from '@stakeward/core';
import { LockOpenIcon, RefreshCwIcon, TerminalIcon, TriangleAlertIcon } from 'lucide-react';
import { useId, type ReactNode, type Ref } from 'react';
import { Link } from 'wouter';
import { ActionBar } from '@/components/product/action-bar';
import { AddressText } from '@/components/product/address-text';
import { Countdown, formatRemaining, keepTogether } from '@/components/product/countdown';
import { Disclosure } from '@/components/product/disclosure';
import { KeyList, type KeyListItem } from '@/components/product/key-list';
import { RiskNote, riskText } from '@/components/product/risk-note';
import { lockText } from '@/components/product/transaction-summary';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import type { LoadedAccount } from '@/pages/account/AccountView';
import { appLinks } from '@/pages/app/view';
import { cardLock } from '@/pages/recovery/view';
import { SignWhere, type SignMode } from '@/signing/SignWhere';
import { withdrawStage } from './stage.ts';
import type { WithdrawWhat } from './WithdrawSigning.tsx';

type StageBlockProps = {
  headingRef: Ref<HTMLHeadingElement>;
  loaded: LoadedAccount;
  onSign: (what: WithdrawWhat) => void;
  /** Where the second key signs a withdrawal while the lock holds: here, or on another device by link. */
  secondMode: SignMode;
  onSecondMode: (mode: SignMode) => void;
  /** Read the account again (Check again). */
  onCheckAgain: () => void;
  /** The countdown ran out: read the account again (the page throttles it). */
  onCountdownEnd: () => void;
};

/** The withdrawal stage title shown on the stage block and kept as the signing section's heading. */
export function withdrawTitle(what: WithdrawWhat, lamports: bigint): string {
  return what === 'withdraw' ? t('withdraw.ready.title', { amount: formatSol(lamports) }) : t('withdraw.deactivate.title');
}

const LINK_CLASS = 'rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover';

/**
 * F3 step 3, said right above the button it guards (UX rule 6): a main key that may be stolen must not receive the SOL,
 * with the way to Rescue instead.
 */
export function WithdrawRisk({ mainKey }: { mainKey: Address }) {
  return (
    <RiskNote risk="withdraw-compromised" variant="inline">
      <p>
        <Link href={appLinks.rescue(mainKey)} className={LINK_CLASS}>
          {t('withdraw.rescueLink')}
        </Link>
      </p>
    </RiskNote>
  );
}

/**
 * What /withdraw/:account offers for the account as just read (F3): stop staking first, wait for the epoch to end,
 * or withdraw; or why it cannot (another key manages staking, a lock no second key holds). One main action at a time
 * (UX rule 2), ending in an ActionBar with the risk right above its button (DECISIONS.md D109).
 */
export function StageBlock({ headingRef, loaded, onSign, secondMode, onSecondMode, onCheckAgain, onCountdownEnd }: StageBlockProps) {
  const headingId = useId();
  // Epoch ends are estimated from the device clock at the read: the countdown ticks on the device clock. Slots count
  // at this epoch's own average so far, read from the cluster clock.
  const { account, clock, epoch, readAt: nowSec } = loaded;
  const slotMs = slotMsEstimate(clock, epoch);
  const mainKey = account.withdrawer;
  const heading = (text: string) => (
    <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-pretty">
      {text}
    </h2>
  );
  switch (withdrawStage(account, clock)) {
    case 'deactivate': {
      const left = epochEndEstimate(epoch, nowSec, epoch.epoch, slotMs) - nowSec;
      // Delegated in this epoch: stopping it now makes it inactive at once (activation epoch = deactivation epoch).
      const activating = stakeActivationStatus(account.delegation, clock.epoch) === 'activating';
      return (
        <Stage headingId={headingId}>
          <div className="flex flex-col gap-2">
            {heading(withdrawTitle('deactivate', account.lamports))}
            <p className="max-w-prose text-pretty">
              {activating
                ? t('withdraw.deactivate.bodyActivating')
                : t('withdraw.deactivate.body', { time: keepTogether(formatRemaining(Number(left), true)) })}
            </p>
          </div>
          <KeyList items={[{ role: 'main', address: mainKey, note: t('withdraw.keys.signsAlone') }]} />
          <ActionBar
            risk={<WithdrawRisk mainKey={mainKey} />}
            primary={
              <Button
                onClick={() => {
                  onSign('deactivate');
                }}
              >
                {t('withdraw.deactivate.action')}
              </Button>
            }
          />
        </Stage>
      );
    }
    case 'service-staker':
      // One block (DECISIONS.md D109): who manages staking, that key in full, and the way out if it is not the user's.
      return (
        <section aria-labelledby={headingId} data-slot="service-staker">
          <Alert tone="warning" role="note">
            <TriangleAlertIcon aria-hidden="true" />
            <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-base font-semibold text-foreground">
              {t('withdraw.serviceStaker.title')}
            </h2>
            <AlertDescription className="flex flex-col gap-3 text-sm text-foreground">
              <p className="max-w-prose">{t('withdraw.serviceStaker.body')}</p>
              <AddressText address={account.staker} variant="full" explorer />
              <div>
                <Button asChild>
                  <Link href={appLinks.rescue(mainKey)}>{t('withdraw.serviceStaker.action')}</Link>
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        </section>
      );
    case 'deactivating': {
      const until = account.delegation?.deactivationEpoch ?? epoch.epoch;
      return (
        <Stage headingId={headingId}>
          {heading(t('withdraw.deactivating.title'))}
          <Countdown to={epochEndEstimate(epoch, nowSec, until, slotMs)} label={t('withdraw.deactivating.label')} onEnd={onCountdownEnd} />
          <div className="flex flex-col gap-2">
            <p className="max-w-prose text-sm text-muted">{t('withdraw.deactivating.body')}</p>
            {/* No decision here: the risk is a quiet line until the withdrawal is offered again. */}
            <p data-risk="withdraw-compromised" className="max-w-prose text-sm text-muted">
              {riskText('withdraw-compromised')}{' '}
              <Link href={appLinks.rescue(mainKey)} className={LINK_CLASS}>
                {t('withdraw.rescueLink')}
              </Link>
            </p>
          </div>
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
      const lock = lockText(lockup, clock);
      const keys: KeyListItem[] = inForce
        ? [
            { role: 'main', address: mainKey, note: t('withdraw.keys.main') },
            { role: 'second', address: lockup.custodian, note: t('withdraw.keys.second', { lock }) },
          ]
        : [
            {
              role: 'main',
              address: mainKey,
              // "No lock" or "Lock ended on <date>": a stake that never had a lock is not told one ended.
              note: (
                <>
                  <span>{t('withdraw.keys.main')}</span>
                  <span>{t('withdraw.ready.mainAlone', { lock })}</span>
                </>
              ),
            },
          ];
      return (
        <Stage headingId={headingId}>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            {heading(withdrawTitle('withdraw', account.lamports))}
            {/* The validator's way, next to the keys: the same withdrawal with the Solana CLI, on the recovery card of
                this pair of keys. */}
            {cardLock(account, clock) === 'protected' ? (
              <Button asChild variant="ghost" size="sm" className="-ml-3 sm:ml-0 sm:-mr-3">
                <Link href={appLinks.recovery(account.address)}>
                  <TerminalIcon aria-hidden="true" />
                  {t('withdraw.cliLink')}
                </Link>
              </Button>
            ) : null}
          </div>
          <KeyList items={keys} />
          {/* Step 7: the second key signs here or on another device by link (spec 10.2). The "here" option says that a
              phone wallet's own browser holds only that wallet (UX rule 10). */}
          {inForce ? <SignWhere role="second" value={secondMode} onChange={onSecondMode} /> : null}
          <ActionBar
            risk={<WithdrawRisk mainKey={mainKey} />}
            primary={
              <Button
                onClick={() => {
                  onSign('withdraw');
                }}
              >
                {t('withdraw.ready.action')}
              </Button>
            }
          />
          {/* F3.4: the second key lifts the lock alone, then the main key withdraws alone. Not for a lock an epoch
              holds: removing the date would not end it. Its risk is said on /extend, where that decision is made. */}
          {inForce && lockup.epoch <= clock.epoch ? (
            <div data-slot="withdraw-fallback" className="flex flex-col items-start">
              <p className="max-w-prose text-sm text-muted">{t('withdraw.fallback.body')}</p>
              <Button asChild variant="ghost" size="sm" className="-ml-3">
                <Link href={`${appLinks.extend(account.address)}?remove`}>
                  <LockOpenIcon aria-hidden="true" />
                  {t('withdraw.fallback.action')}
                </Link>
              </Button>
            </div>
          ) : null}
        </Stage>
      );
    }
    case 'unsupported-lock':
      return (
        <Alert tone="warning" role="note">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription className="flex flex-col gap-2 text-foreground">
            <p className="font-medium">{t('withdraw.unsupportedLockTitle')}</p>
            <Disclosure summary={t('common.details')} className="text-sm">
              <p className="max-w-prose">{t('withdraw.unsupportedLock')}</p>
            </Disclosure>
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
