import type { Address } from '@solana/kit';
import { formatUtcDate, validateNewSecondKey } from '@stakeward/core';
import { TriangleAlertIcon } from 'lucide-react';
import { useId, type Ref } from 'react';
import { Link } from 'wouter';
import { AddressText } from '@/components/product/address-text';
import { RiskNote } from '@/components/product/risk-note';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { t } from '@/i18n';
import type { LoadedAccount } from '@/pages/account/AccountView';
import { KeySlot } from '@/pages/app/KeySlot';
import { appLinks } from '@/pages/app/view';
import { extendStage } from '@/pages/extend/options';
import { ContinueButtons } from '@/pages/protect/StepButtons';
import { useKnownSecondKeys, useSlot } from '@/ports';
import { newKeyProblemText } from './plan.ts';

type SecondKeyChooseProps = {
  headingRef: Ref<HTMLHeadingElement>;
  loaded: LoadedAccount;
  seedConfirmed: boolean;
  onSeed: (value: boolean) => void;
  /** Continue with this new second key (connected, checked, and the seed phrase confirmed). */
  onContinue: (newSecondKey: Address) => void;
};

/**
 * What /second-key/:account offers for the lock as just read (F7): the second key that holds it now, the new second key
 * to connect (a wallet, never a typed address: it must sign), what is wrong with it, the risks with the lock's date
 * (UX rule 6) and the seed phrase confirmation; or why there is nothing to hand over here.
 */
export function SecondKeyChoose({ headingRef, loaded, seedConfirmed, onSeed, onContinue }: SecondKeyChooseProps) {
  const headingId = useId();
  const seedId = useId();
  const seedHintId = useId();
  const { account, clock } = loaded;
  const { lockup } = account;
  const slot = useSlot('new');
  const knownSecondKeys = useKnownSecondKeys();
  const newKey = slot?.ready === true ? slot.slot.address : null;

  switch (extendStage(account, clock)) {
    case 'epoch-locked':
      return (
        <Alert tone="warning" role="note">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription className="flex flex-col gap-3 text-foreground">
            <p className="font-medium">{t('secondKey.epochLocked', { epoch: lockup.epoch.toString() })}</p>
            <div>
              <Button asChild variant="outline">
                <Link href={`/recovery/${account.address}`}>{t('common.pages.recovery')}</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      );
    case 'not-locked':
      return (
        <div className="flex flex-col items-start gap-3">
          <p className="max-w-prose">{t('secondKey.notLocked')}</p>
          <Button asChild variant="outline">
            <Link href={appLinks.protect([account.address])}>{t('secondKey.protect')}</Link>
          </Button>
        </div>
      );
    case 'ready': {
      const current = lockup.custodian;
      const end = formatUtcDate(lockup.unixTimestamp) ?? lockup.unixTimestamp.toString();
      const problems =
        newKey === null
          ? []
          : validateNewSecondKey({
              second: newKey,
              mainKey: account.withdrawer,
              staker: account.staker,
              stakeAccount: account.address,
              current,
            });
      const blockers = [
        ...(newKey === null ? [t('secondKey.choose.needNewKey')] : []),
        ...(problems.length > 0 ? [t('secondKey.choose.fixProblem')] : []),
        ...(seedConfirmed ? [] : [t('secondKey.choose.needSeedCheck')]),
      ];
      return (
        <section aria-labelledby={headingId} className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-2xl font-semibold">
              {t('secondKey.choose.heading')}
            </h2>
            <p className="max-w-prose text-muted">{t('secondKey.choose.body')}</p>
          </div>
          <div className="flex flex-col gap-1" data-slot="current-second-key">
            {/* A holder this device does not know is named neutrally (D14, D95): it may be the thief's key. */}
            <p className="text-sm font-medium">
              {knownSecondKeys.includes(current) ? t('common.roles.second') : t('secondKey.choose.holder')}
            </p>
            <AddressText address={current} variant="full" />
            <p className="max-w-prose text-sm text-muted">{t('secondKey.choose.current')}</p>
            {knownSecondKeys.includes(current) ? null : (
              <p className="max-w-prose text-sm" data-slot="unknown-holder">
                {t('secondKey.choose.unknownHolder')}{' '}
                <Link
                  href={`/recovery/${account.address}`}
                  className="rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
                >
                  {t('common.pages.recovery')}
                </Link>
              </p>
            )}
          </div>
          <KeySlot role="new" mainKey={account.withdrawer} description={t('secondKey.choose.slotDescription')} />
          <p className="max-w-prose text-sm text-muted">{t('secondKey.choose.oneBrowser')}</p>
          {newKey === null ? null : (
            <div className="flex flex-col gap-1" data-slot="new-second-key">
              <p className="text-sm font-medium">{t('secondKey.choose.newKey')}</p>
              <AddressText address={newKey} variant="full" />
            </div>
          )}
          {problems.length === 0 ? null : (
            <Alert tone="danger" role="note" data-slot="new-key-problems">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertDescription className="text-foreground">
                <p>{problems.map(newKeyProblemText).join(' ')}</p>
              </AlertDescription>
            </Alert>
          )}
          <RiskNote risk="second-key-can-freeze">
            <p>{t('secondKey.choose.endStays', { date: end })}</p>
          </RiskNote>
          <RiskNote risk="lose-second-key" date={lockup.unixTimestamp} />
          <div className="flex items-start gap-3">
            <Checkbox
              id={seedId}
              checked={seedConfirmed}
              aria-describedby={seedHintId}
              className="mt-0.5"
              onCheckedChange={(value) => {
                onSeed(value === true);
              }}
            />
            <div className="flex flex-col gap-1">
              <Label htmlFor={seedId}>{t('secondKey.choose.seedCheck')}</Label>
              <p id={seedHintId} className="text-sm text-muted">
                {t('secondKey.choose.seedHint')}
              </p>
            </div>
          </div>
          <ContinueButtons
            problems={blockers}
            onContinue={() => {
              if (newKey !== null) onContinue(newKey);
            }}
          />
        </section>
      );
    }
  }
}
