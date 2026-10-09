import { formatUtcDate } from '@stakeward/core';
import { TriangleAlertIcon } from 'lucide-react';
import { useId, type Ref } from 'react';
import { Link } from 'wouter';
import { ActionBar } from '@/components/product/action-bar';
import { RadioCardGroup, type RadioCardOption } from '@/components/product/radio-card';
import { RiskNote } from '@/components/product/risk-note';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CLUSTER } from '@/config';
import { t } from '@/i18n';
import type { LoadedAccount } from '@/pages/account/AccountView';
import { appLinks } from '@/pages/app/view';
import { clockSkew } from '@/pages/protect/clock';
import { ClockSkewError } from '@/pages/protect/ClockSkewError';
import { choiceValue, defaultChoice, extendOptions, extendStage, type ExtendChoice } from './options.ts';

/** A date in the page's words; a lock end out of a Date's range shows its seconds rather than nothing. */
function dateText(seconds: bigint): string {
  return formatUtcDate(seconds) ?? seconds.toString();
}

/** The words of a choice: its period and end date, or removing the lock. */
export function choiceText(choice: ExtendChoice): string {
  if (choice.kind === 'remove') return t('extend.remove');
  return t('extend.option', { period: t(`extend.periods.${choice.period}`), date: dateText(choice.until) });
}

/** A choice as a radio card: the period with its end date under it and "Recommended" on 6 months; removing apart. */
function choiceOption(choice: ExtendChoice): RadioCardOption {
  if (choice.kind === 'remove') return { value: choiceValue(choice), title: t('extend.remove'), tone: 'danger' };
  return {
    value: choiceValue(choice),
    title: t(`extend.periods.${choice.period}`),
    meta: t('extend.until', { date: dateText(choice.until) }),
    badge: choice.period === '6-months' ? <Badge tone="success">{t('extend.recommended')}</Badge> : undefined,
  };
}

type ExtendChooseProps = {
  headingRef: Ref<HTMLHeadingElement>;
  loaded: LoadedAccount;
  /** The page was opened to remove the lock (`?remove`, from /withdraw's fallback). */
  removeParam: boolean;
  /** The radio value the user picked; null: the default. */
  selected: string | null;
  onSelect: (value: string) => void;
  /** Read the account and the clocks again (after a clock that did not match this device). */
  onReread: () => void;
  onContinue: (choice: ExtendChoice) => void;
};

/**
 * What /extend/:account offers for the lock as just read (F5): a later end, or removing the lock now, each with its
 * risk said right above the button (UX rule 6, DECISIONS.md D109); or why there is nothing to change here. Nothing is
 * offered when the cluster clock was more than a day off this device's clock at the read: the new ends are computed
 * from it (SECURITY-CHECK П12).
 */
export function ExtendChoose({ headingRef, loaded, removeParam, selected, onSelect, onReread, onContinue }: ExtendChooseProps) {
  const headingId = useId();
  const { account, clock } = loaded;
  const { lockup } = account;
  const skew = clockSkew(clock.unixTimestamp, loaded.readAt);
  if (skew !== null) return <ClockSkewError skew={skew} onRetry={onReread} />;
  switch (extendStage(account, clock)) {
    case 'epoch-locked':
      return (
        <Alert tone="warning" role="note">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription className="text-foreground">
            <p className="font-medium">{t('extend.epochLocked', { epoch: lockup.epoch.toString() })}</p>
          </AlertDescription>
        </Alert>
      );
    case 'not-locked':
      return (
        <div className="flex flex-col items-start gap-3">
          <p className="max-w-prose">{t('extend.notLocked')}</p>
          <Button asChild>
            <Link href={appLinks.protect([account.address])}>{t('extend.protect')}</Link>
          </Button>
        </div>
      );
    case 'ready': {
      const choices = extendOptions(lockup.unixTimestamp, clock, CLUSTER);
      const choice = choices.find((candidate) => choiceValue(candidate) === selected) ?? defaultChoice(choices, removeParam);
      const removing = choice.kind === 'remove';
      return (
        <section aria-labelledby={headingId} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold">
              {t('extend.legend')}
            </h2>
            <p className="text-sm text-muted tabular-nums">{t('extend.now', { date: dateText(lockup.unixTimestamp) })}</p>
            {choices.length === 1 ? <p className="max-w-prose text-sm text-muted">{t('extend.noLater')}</p> : null}
          </div>
          <RadioCardGroup
            legend={t('extend.legend')}
            legendHidden
            columns={2}
            value={choiceValue(choice)}
            onValueChange={(value) => {
              if (choices.some((candidate) => choiceValue(candidate) === value)) onSelect(value);
            }}
            options={choices.map(choiceOption)}
          />
          <ActionBar
            risk={
              removing ? (
                <RiskNote risk="unlock-opens-window" tone="danger" variant="inline" />
              ) : (
                <RiskNote risk="lose-second-key" date={choice.until} variant="inline" />
              )
            }
            note={t('extend.phone')}
            primary={
              // Removing the lock takes the protection away: the one filled button turns danger (DECISIONS.md D109).
              <Button
                variant={removing ? 'danger' : 'primary'}
                onClick={() => {
                  onContinue(choice);
                }}
              >
                {removing ? t('extend.reviewRemove') : t('extend.review')}
              </Button>
            }
          />
        </section>
      );
    }
  }
}
