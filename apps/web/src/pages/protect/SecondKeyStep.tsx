import type { Address } from '@solana/kit';
import { shortAddress } from '@stakeward/core';
import { TriangleAlertIcon } from 'lucide-react';
import { useId, type Ref } from 'react';
import { RiskNote } from '@/components/product/risk-note';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { t } from '@/i18n';
import { KeySlot } from '@/pages/app/KeySlot';
import { useSlot } from '@/ports';
import { AddressField, addressInputError, parseAddressInput } from '@/signing/AddressField';
import { SignWhere, type SignMode } from '@/signing/SignWhere';
import { blockerText, ContinueButtons } from './StepButtons.tsx';
import type { Blocker, SecondKeyProblem } from './wizard.ts';

type SecondKeyStepProps = {
  headingRef: Ref<HTMLHeadingElement>;
  mainKey: Address;
  /** Both keys are accounts of this wallet (its name), or null. */
  sameWallet: string | null;
  problems: readonly SecondKeyProblem[];
  /** Chosen accounts whose lock this second key held before (a removed or ended lock): a warning, not a refusal. */
  heldBefore: readonly Address[];
  seedConfirmed: boolean;
  /** Where the second key signs: connected here, or on another device by link (its address typed in `linkKey`). */
  mode: SignMode;
  linkKey: string;
  blockers: readonly Blocker[];
  onSeed: (value: boolean) => void;
  onMode: (mode: SignMode) => void;
  onLinkKey: (text: string) => void;
  onLeaveOut: (account: Address) => void;
  onBack: () => void;
  onContinue: () => void;
};

/**
 * Step 2 (F1 step 2): the second key, connected in this browser (its slot's Connect is the step's one filled button
 * while it is empty) or pasted for signing by link (step 7 spec 10.1). The choice between the two opens the step. The risks come before the signature (UX rule 6): the second key can freeze the stake, both keys from one seed
 * phrase protect nothing (the user confirms it; two accounts of one wallet app get a warning), and a second key used on
 * other sites can be tricked into handing the lock away. By link the joint signature on the chain stays the only proof
 * (F1.4), but it proves only that whoever holds the pasted address signed: the hint says to paste only a wallet the
 * user or someone they trust made (SECURITY-CHECK П5, П8, П14).
 */
export function SecondKeyStep(props: SecondKeyStepProps) {
  const { headingRef, mainKey, sameWallet, problems, heldBefore, mode, linkKey } = props;
  const headingId = useId();
  const seedId = useId();
  const hintId = useId();
  const byLink = mode === 'link';
  // "Connecting signs nothing." is for an empty slot: a connected one has nothing left to reassure about.
  const slot = useSlot('second');
  const secondConnected = slot !== null && slot.wallet !== null && slot.ready;
  const parsed = parseAddressInput(linkKey);
  // By link the field says what is wrong with a typed address; an empty one is said only when Continue is pressed.
  const fieldError = parsed.ok || parsed.reason === 'empty' ? null : addressInputError(parsed.reason);
  const problemTexts = props.blockers.map((blocker) =>
    blocker === 'need-second' && byLink && !parsed.ok ? addressInputError(parsed.reason) : blockerText(blocker),
  );
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-6 text-pretty">
      <div className="flex flex-col gap-2">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-balance">
          {byLink ? t('protect.second.headingLink') : t('protect.second.heading')}
        </h2>
        <p className="max-w-prose text-muted">{t('protect.second.body')}</p>
      </div>
      {/*
        The choice of where the key signs comes first and always shows, so signing by link is never hidden behind a
        toggle. It keeps its position in either mode, so it is never moved or remounted while it has focus; under it
        comes what that mode asks for: the slot to connect here, or the address to sign by link.
      */}
      <div className="flex flex-col gap-4">
        <SignWhere role="second" value={mode} onChange={props.onMode} />
        {byLink ? (
          <AddressField
            label={t('protect.second.linkAddress')}
            hint={t('protect.second.linkHint')}
            value={linkKey}
            onChange={props.onLinkKey}
            error={fieldError}
          />
        ) : (
          <KeySlot
            role="second"
            mainKey={mainKey}
            emphasis="primary"
            description={secondConnected ? undefined : t('protect.second.slotDescription')}
          />
        )}
      </div>
      {byLink || sameWallet === null ? null : (
        <Alert tone="warning" role="note">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription className="flex flex-col gap-1 text-foreground">
            <p className="font-medium">{t('protect.second.sameWallet', { wallet: sameWallet })}</p>
            <p>{t('protect.second.sameWalletSwitch', { wallet: sameWallet })}</p>
          </AlertDescription>
        </Alert>
      )}
      {heldBefore.length === 0 ? null : (
        // After a "second key may be stolen" alert the owner removes the lock and comes here with the old key still
        // connected (SECURITY-CHECK П9).
        <Alert tone="warning" role="note" data-slot="former-second-key">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription className="text-foreground">
            <p>
              {heldBefore.length === 1
                ? t('protect.second.heldBeforeOne', { address: shortAddress(heldBefore[0] as Address) })
                : t('protect.second.heldBeforeOther', { count: heldBefore.length })}
            </p>
          </AlertDescription>
        </Alert>
      )}
      {problems.length === 0 ? null : (
        <Alert tone="danger" role="note" data-slot="second-key-problems">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription className="text-foreground">
            <ul className="flex flex-col gap-3">
              {problems.map((problem) => {
                const address = shortAddress(problem.account);
                return (
                  <li key={problem.account} className="flex flex-col items-start gap-2">
                    <p>{problem.violations.map((violation) => t(`protect.second.problem.${violation}`, { address })).join(' ')}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        props.onLeaveOut(problem.account);
                      }}
                    >
                      {t('protect.second.leaveOut', { address })}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <RiskNote risk="second-key-can-freeze">
        <p>{t('protect.second.onlyStakeward')}</p>
      </RiskNote>
      <div className="flex items-start gap-3">
        <Checkbox
          id={seedId}
          checked={props.seedConfirmed}
          aria-describedby={hintId}
          className="mt-0.5"
          onCheckedChange={(value) => {
            props.onSeed(value === true);
          }}
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor={seedId}>{t('protect.second.seedCheck')}</Label>
          <p id={hintId} className="text-sm text-muted">
            {t('protect.second.seedHint')}
          </p>
        </div>
      </div>
      <ContinueButtons label={t('protect.continue.second')} problems={problemTexts} onContinue={props.onContinue} onBack={props.onBack} />
    </section>
  );
}
