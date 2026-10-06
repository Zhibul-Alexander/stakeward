import { formatUtcDate } from '@stakeward/core';
import { TriangleAlertIcon } from 'lucide-react';
import { useId, type Ref } from 'react';
import { Link } from 'wouter';
import { AddressText } from '@/components/product/address-text';
import { RiskNote } from '@/components/product/risk-note';
import { lockText } from '@/components/product/transaction-summary';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { CLUSTER } from '@/config';
import { t } from '@/i18n';
import type { LoadedAccount } from '@/pages/account/AccountView';
import { appLinks } from '@/pages/app/view';
import { clockSkew } from '@/pages/protect/clock';
import { ClockSkewError } from '@/pages/protect/ClockSkewError';
import { choiceValue, defaultChoice, extendOptions, extendStage, type ExtendChoice } from './options.ts';

/** The words of a choice: its period and end date, or removing the lock. */
export function choiceText(choice: ExtendChoice): string {
  if (choice.kind === 'remove') return t('extend.remove');
  return t('extend.option', {
    period: t(`protect.period.options.${choice.period}`),
    date: formatUtcDate(choice.until) ?? choice.until.toString(),
  });
}

type ExtendChooseProps = {
  headingRef: Ref<HTMLHeadingElement>;
  loaded: LoadedAccount;
  /** The page was opened to remove the lock (`?remove`, from /withdraw's fallback or a lock-change alert). */
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
 * risk said before the action (UX rule 6); or why there is nothing to change here. Nothing is offered when the cluster
 * clock was more than a day off this device's clock at the read: the new ends are computed from it (SECURITY-CHECK
 * П12).
 */
export function ExtendChoose({ headingRef, loaded, removeParam, selected, onSelect, onReread, onContinue }: ExtendChooseProps) {
  const headingId = useId();
  const removeHintId = useId();
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
          <Button asChild variant="outline">
            <Link href={appLinks.protect([account.address])}>{t('extend.protect')}</Link>
          </Button>
        </div>
      );
    case 'ready': {
      const choices = extendOptions(lockup.unixTimestamp, clock, CLUSTER);
      const choice = choices.find((candidate) => choiceValue(candidate) === selected) ?? defaultChoice(choices, removeParam);
      return (
        <section aria-labelledby={headingId} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <p className="max-w-prose">{t('extend.current', { lock: lockText(lockup, clock) })}</p>
            <AddressText address={lockup.custodian} variant="full" />
          </div>
          {choices.length === 1 ? <p className="max-w-prose text-sm text-muted">{t('extend.noLater')}</p> : null}
          <div className="flex flex-col gap-3">
            <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-xl font-semibold">
              {t('extend.legend')}
            </h2>
            <RadioGroup
              aria-labelledby={headingId}
              value={choiceValue(choice)}
              onValueChange={(value) => {
                if (choices.some((candidate) => choiceValue(candidate) === value)) onSelect(value);
              }}
            >
              {choices.map((option) => {
                const value = choiceValue(option);
                const id = `${headingId}-${value}`;
                return (
                  <div key={value} className="flex items-start gap-3">
                    <RadioGroupItem
                      value={value}
                      id={id}
                      className="mt-0.5"
                      aria-describedby={option.kind === 'remove' ? removeHintId : undefined}
                    />
                    <div className="flex flex-col gap-0.5">
                      <Label htmlFor={id}>{choiceText(option)}</Label>
                      {option.kind === 'remove' ? (
                        <p id={removeHintId} className="text-sm text-muted">
                          {t('extend.removeHint')}
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </RadioGroup>
          </div>
          {choice.kind === 'remove' ? (
            <RiskNote risk="unlock-opens-window" tone="danger" />
          ) : (
            <RiskNote risk="lose-second-key" date={choice.until} />
          )}
          <p className="max-w-prose text-sm text-muted">{t('extend.phone')}</p>
          <div>
            <Button
              onClick={() => {
                onContinue(choice);
              }}
            >
              {t('extend.continue')}
            </Button>
          </div>
        </section>
      );
    }
  }
}
