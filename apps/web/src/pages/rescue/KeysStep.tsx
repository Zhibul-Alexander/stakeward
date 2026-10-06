import type { Address } from '@solana/kit';
import { useId, type Ref } from 'react';
import { AddressText } from '@/components/product/address-text';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { t } from '@/i18n';
import { KeySlot } from '@/pages/app/KeySlot';
import { ContinueButtons } from '@/pages/protect/StepButtons';
import { SignWhere, type SignMode } from '@/signing/SignWhere';
import { SameWalletWarning, type SameWallet } from './SameWalletWarning.tsx';
import { rescueBlockers, type RescueBlocker } from './wizard.ts';

type KeysStepProps = {
  headingRef: Ref<HTMLHeadingElement>;
  mainKey: Address;
  newWallet: Address;
  /** Second keys that hold a lock on this stake (secondKeyChoices). */
  choices: readonly Address[];
  /** The second key of this run: the chosen (or only) one, or the second key slot's when nothing is locked. */
  secondKey: Address | null;
  /** The new wallet's wallet app also holds these keys, or null (SECURITY-CHECK П5): a key connected here counts too. */
  sameWallet: SameWallet | null;
  mainMode: SignMode;
  secondMode: SignMode;
  onChoose: (secondKey: Address) => void;
  onMainMode: (mode: SignMode) => void;
  onSecondMode: (mode: SignMode) => void;
  onBack: () => void;
  onContinue: () => void;
};

function blockerText(blocker: RescueBlocker): string {
  switch (blocker) {
    case 'need-second':
      return t('rescue.keys.needSecond');
    case 'second-problem':
      return t('rescue.keys.secondProblem');
    default:
      return t('errors.unknown');
  }
}

/**
 * Step 3 (F4 steps 4-5): which second key co-signs this run, and where the main key and the second key sign: in this
 * browser, or on another device by link. The new wallet always signs here: it pays and owns the link-signing account.
 * A second key connected here from the new wallet's wallet app gets the same-wallet warning.
 */
export function KeysStep(props: KeysStepProps) {
  const { headingRef, mainKey, newWallet, choices, secondKey, sameWallet, mainMode, secondMode } = props;
  const headingId = useId();
  const legendId = useId();
  const blockers = rescueBlockers('keys', {
    mainKey,
    movable: 0,
    choices: choices.length,
    newWallet,
    newProblems: 0,
    seedConfirmed: true,
    balance: null,
    needed: null,
    secondKey,
  });
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-6">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-2xl font-semibold">
        {t('rescue.keys.heading')}
      </h2>
      {choices.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="max-w-prose text-sm">{t('rescue.keys.noLock')}</p>
          <KeySlot role="second" mainKey={mainKey} />
        </div>
      ) : choices.length === 1 || secondKey === null ? (
        secondKey === null ? null : (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">{t('rescue.keys.secondKey')}</span>
            <AddressText address={secondKey} variant="full" />
          </div>
        )
      ) : (
        <fieldset className="flex flex-col gap-3">
          <legend id={legendId} className="mb-3 text-sm font-medium">
            {t('rescue.keys.chooseSecond')}
          </legend>
          <RadioGroup
            aria-labelledby={legendId}
            value={secondKey}
            onValueChange={(value) => {
              const chosen = choices.find((candidate) => candidate === value);
              if (chosen !== undefined) props.onChoose(chosen);
            }}
          >
            {choices.map((choice) => (
              <div key={choice} className="flex items-start gap-3">
                <RadioGroupItem value={choice} id={`${legendId}-${choice}`} className="mt-0.5" />
                <Label htmlFor={`${legendId}-${choice}`} className="min-w-0 font-mono break-all">
                  {choice}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </fieldset>
      )}
      {sameWallet === null ? null : <SameWalletWarning sameWallet={sameWallet} action="continue" />}
      <SignWhere role="main" value={mainMode} onChange={props.onMainMode} />
      <SignWhere
        role="second"
        value={secondMode}
        onChange={props.onSecondMode}
        disabledLink={choices.length === 0 ? t('rescue.keys.noLockLink') : undefined}
      />
      {mainMode === 'link' && secondMode === 'link' ? <p className="max-w-prose text-sm font-medium">{t('rescue.keys.linkSame')}</p> : null}
      <ContinueButtons problems={blockers.map(blockerText)} onContinue={props.onContinue} onBack={props.onBack} />
    </section>
  );
}
