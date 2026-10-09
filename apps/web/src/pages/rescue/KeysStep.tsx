import type { Address } from '@solana/kit';
import type { WalletRole } from '@stakeward/core';
import { useId, type ReactNode, type Ref } from 'react';
import { AddressText } from '@/components/product/address-text';
import { RadioCardGroup } from '@/components/product/radio-card';
import { roleLabel } from '@/components/product/wallet-slot';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { t } from '@/i18n';
import { KeySlot } from '@/pages/app/KeySlot';
import { ContinueButtons } from '@/pages/protect/StepButtons';
import type { SignMode } from '@/signing/SignWhere';
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

/** One row of the signers table: the role and its address on the left, where it signs on the right (from 640 px). */
function SignerRow({ role, address, children }: { role: WalletRole; address: Address | null; children: ReactNode }) {
  return (
    <li data-role={role} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:gap-x-4 sm:px-4">
      <div className="flex flex-col items-start sm:w-36 sm:shrink-0">
        <span className="text-sm font-semibold">{roleLabel(role)}</span>
        {address === null ? (
          <span className="text-sm text-muted">{t('rescue.keys.notConnected')}</span>
        ) : (
          <AddressText address={address} />
        )}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

/** Where one key signs: two small cards, "This browser" and "By link"; the legend names the role for screen readers. */
function WhereCards({
  role,
  value,
  onChange,
  disabledLink,
}: {
  role: WalletRole;
  value: SignMode;
  onChange: (mode: SignMode) => void;
  disabledLink?: string | undefined;
}) {
  return (
    <RadioCardGroup
      legend={t('signing.where.legend', { role: roleLabel(role) })}
      legendHidden
      columns={2}
      // Two short choices: side by side at every width, so the table stays one screen on a phone. Below 640 px the
      // cards are tighter, so "This browser" stays on one line at 360 px.
      className="[&_[data-slot=radio-card]]:gap-2 [&_[data-slot=radio-card]]:p-2.5 sm:[&_[data-slot=radio-card]]:gap-3 sm:[&_[data-slot=radio-card]]:p-3 [&_[role=radiogroup]]:grid-cols-2 [&_[role=radiogroup]]:gap-2 sm:[&_[role=radiogroup]]:gap-3"
      value={value}
      onValueChange={(next) => {
        if (next === 'here' || next === 'link') onChange(next);
      }}
      options={[
        { value: 'here', title: t('rescue.keys.here') },
        { value: 'link', title: t('rescue.keys.link'), disabledReason: disabledLink },
      ]}
    />
  );
}

/**
 * Step 3 (F4 steps 4-5): who signs the move, as one table (DECISIONS.md D112). The new wallet always signs here: it pays
 * and owns the link-signing account. The main key and the second key each sign in this browser or on another device by
 * link. With several second keys the user picks the one for this run; with none, any other wallet of theirs is
 * connected as the second key. A second key connected here from the new wallet's wallet app gets the same-wallet
 * warning.
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
    <section aria-labelledby={headingId} className="flex flex-col gap-5">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold">
        {t('rescue.keys.heading')}
      </h2>
      {choices.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="max-w-prose">{t('rescue.keys.noLock')}</p>
          <KeySlot role="second" mainKey={mainKey} />
        </div>
      ) : choices.length > 1 && secondKey !== null ? (
        <fieldset className="flex flex-col">
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
      ) : null}
      <div className="flex flex-col gap-2">
        <ul role="list" data-slot="rescue-signers" aria-labelledby={headingId} className="divide-y divide-border rounded-lg border border-border bg-surface">
          <SignerRow role="new" address={newWallet}>
            <p className="text-sm">
              <span className="font-medium">{t('rescue.keys.here')}</span>
              <span className="text-muted"> · {t('rescue.keys.newHere')}</span>
            </p>
          </SignerRow>
          <SignerRow role="main" address={mainKey}>
            <WhereCards role="main" value={mainMode} onChange={props.onMainMode} />
          </SignerRow>
          <SignerRow role="second" address={secondKey}>
            <WhereCards
              role="second"
              value={secondMode}
              onChange={props.onSecondMode}
              disabledLink={choices.length === 0 ? t('rescue.keys.noLockLink') : undefined}
            />
          </SignerRow>
        </ul>
        <p className="max-w-prose text-sm text-muted">{t('rescue.keys.byLink')}</p>
        {mainMode === 'link' && secondMode === 'link' ? <p className="max-w-prose text-sm font-medium">{t('rescue.keys.linkSame')}</p> : null}
      </div>
      {sameWallet === null ? null : <SameWalletWarning sameWallet={sameWallet} action="continue" />}
      <ContinueButtons label={t('rescue.next.move')} problems={blockers.map(blockerText)} onContinue={props.onContinue} onBack={props.onBack} />
    </section>
  );
}
