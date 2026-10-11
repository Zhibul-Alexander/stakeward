import { formatUtcDate, isLockupInForce } from '@stakeward/core';
import { TriangleAlertIcon } from 'lucide-react';
import { useId, type Ref } from 'react';
import { Link } from 'wouter';
import { ActionBar } from '@/components/product/action-bar';
import { Disclosure } from '@/components/product/disclosure';
import { RadioCardGroup, type RadioCardOption } from '@/components/product/radio-card';
import { RiskNote } from '@/components/product/risk-note';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CLUSTER } from '@/config';
import { t } from '@/i18n';
import type { LoadedAccount } from '@/pages/account/AccountView';
import { appLinks } from '@/pages/app/view';
import { clockSkew } from '@/pages/protect/clock';
import { ClockSkewError } from '@/pages/protect/ClockSkewError';
import {
  choiceValue,
  customExtendBounds,
  customExtendEnd,
  defaultChoice,
  extendOptions,
  extendStage,
  type ExtendChoice,
} from './options.ts';

/** A date in the page's words; a lock end out of a Date's range shows its seconds rather than nothing. */
function dateText(seconds: bigint): string {
  return formatUtcDate(seconds) ?? seconds.toString();
}

/** The words of a choice: its period and end date, or removing the lock. */
export function choiceText(choice: ExtendChoice): string {
  if (choice.kind === 'remove') return t('extend.remove');
  const period = choice.kind === 'custom' ? t('extend.periods.custom') : t(`extend.periods.${choice.period}`);
  return t('extend.option', { period, date: dateText(choice.until) });
}

/** A choice as a radio card: the period with its end date under it and "Recommended" on 6 months; removing apart. */
function choiceOption(choice: ExtendChoice): RadioCardOption {
  if (choice.kind === 'remove') return { value: choiceValue(choice), title: t('extend.remove'), tone: 'danger' };
  if (choice.kind === 'custom') {
    return { value: 'custom', title: t('extend.periods.custom'), meta: t('extend.until', { date: dateText(choice.until) }) };
  }
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
  /** The date typed for Custom date (`YYYY-MM-DD`, D119). */
  customDate: string;
  onCustomDate: (text: string) => void;
  /** Read the account and the clocks again (after a clock that did not match this device). */
  onReread: () => void;
  onContinue: (choice: ExtendChoice) => void;
};

/**
 * What /extend/:account offers for the lock as just read (F5): a later end, or removing the lock now, each with its
 * risk said right above the button (UX rule 6, DECISIONS.md D112); or why there is nothing to change here. Nothing is
 * offered when the cluster clock was more than a day off this device's clock at the read: the new ends are computed
 * from it (SECURITY-CHECK П12).
 */
export function ExtendChoose({
  headingRef,
  loaded,
  removeParam,
  selected,
  onSelect,
  customDate,
  onCustomDate,
  onReread,
  onContinue,
}: ExtendChooseProps) {
  const headingId = useId();
  const dateId = useId();
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
      // A lock in force here is held by the main key itself or by no key: nothing to protect, nothing a second key can
      // change. Protect it is offered only when there is no lock at all (the wizard would refuse the other).
      return isLockupInForce(lockup, clock) ? (
        <Alert tone="warning" role="note" data-slot="extend-unsupported">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription className="flex flex-col gap-2 text-foreground">
            <p className="font-medium">{t('extend.unsupportedLockTitle')}</p>
            <Disclosure summary={t('common.details')} className="text-sm">
              <p className="max-w-prose">{t('extend.unsupportedLock')}</p>
            </Disclosure>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p className="max-w-prose">{t('extend.notLocked')}</p>
          <Button asChild>
            <Link href={appLinks.protect([account.address])}>{t('extend.protect')}</Link>
          </Button>
        </div>
      );
    case 'ready': {
      const choices = extendOptions(lockup.unixTimestamp, clock, CLUSTER);
      const bounds = customExtendBounds(lockup.unixTimestamp, clock);
      const typed = customExtendEnd(customDate, lockup.unixTimestamp, clock);
      const customChosen = selected === 'custom';
      const custom: ExtendChoice | null = typed.ok ? { kind: 'custom', until: typed.until } : null;
      const choice = customChosen
        ? custom
        : (choices.find((candidate) => choiceValue(candidate) === selected) ?? defaultChoice(choices, removeParam));
      const removing = choice?.kind === 'remove';
      const periods = choices.filter((candidate) => candidate.kind === 'period').length;
      const boundText = (date: string) => {
        const end = customExtendEnd(date, lockup.unixTimestamp, clock);
        return end.ok ? dateText(end.until) : date;
      };
      // A problem is said once something is typed; an empty field only keeps the button from going on.
      const problem = typed.ok || customDate.trim() === '' ? null : typed.problem;
      const options = choices.map(choiceOption);
      // Custom date sits after the periods, before removing (which stands apart).
      options.splice(choices.length - 1, 0, {
        value: 'custom',
        title: t('extend.periods.custom'),
        meta: custom === null ? t('extend.customPick') : t('extend.until', { date: dateText(custom.until) }),
      });
      // Opened to remove (`?remove`), the heading names removing first. Custom date is always offered (D119), so with no
      // later period there is still a new end to pick.
      const legend = removeParam ? t('extend.removeLegend') : t('extend.legend');
      return (
        <section aria-labelledby={headingId} className="flex flex-col gap-5">
          {/* The lock's end now stands on the account row right above (DECISIONS.md D112); the cards give the new ends. */}
          <div className="flex flex-col gap-1">
            <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold">
              {legend}
            </h2>
            {periods === 0 ? <p className="max-w-prose text-sm text-muted">{t('extend.noLater')}</p> : null}
          </div>
          {/* Custom date is always there, so there is always a choice to make. Two columns from two cards on. */}
          <RadioCardGroup
            legend={legend}
            legendHidden
            columns={periods > 0 ? 2 : 1}
            value={customChosen ? 'custom' : choice === null ? 'custom' : choiceValue(choice)}
            onValueChange={(value) => {
              if (value === 'custom' || choices.some((candidate) => choiceValue(candidate) === value)) onSelect(value);
            }}
            options={options}
          />
          {customChosen ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor={dateId}>{t('extend.customLabel')}</Label>
              <Input
                id={dateId}
                type="date"
                className="w-auto max-w-56"
                value={customDate}
                min={bounds.min}
                max={bounds.max}
                required
                aria-invalid={problem !== null}
                aria-describedby={problem === null ? `${dateId}-hint` : `${dateId}-hint ${dateId}-error`}
                onChange={(event) => {
                  onCustomDate(event.target.value);
                }}
              />
              <p id={`${dateId}-hint`} className="text-sm text-muted">
                {t('extend.customHint', { min: boundText(bounds.min), max: boundText(bounds.max) })}
              </p>
              {problem === null ? null : (
                <p id={`${dateId}-error`} role="alert" className="text-sm font-medium text-danger">
                  {t(`extend.customProblem.${problem}`, { min: boundText(bounds.min), max: boundText(bounds.max) })}
                </p>
              )}
            </div>
          ) : null}
          <ActionBar
            risk={
              choice === null ? (
                <p className="text-sm text-muted">{t('extend.needDate')}</p>
              ) : removing ? (
                <RiskNote risk="unlock-opens-window" tone="danger" variant="inline" />
              ) : (
                <RiskNote risk="lose-second-key" date={choice.until} variant="inline" />
              )
            }
            note={t('extend.phone')}
            primary={
              // Removing the lock takes the protection away: the one filled button turns danger (DECISIONS.md D112).
              <Button
                variant={removing ? 'danger' : 'primary'}
                disabled={choice === null}
                onClick={() => {
                  if (choice !== null) onContinue(choice);
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
