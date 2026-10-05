import type { Address } from '@solana/kit';
import { shortAddress } from '@stakeward/core';
import { InfoIcon, TriangleAlertIcon } from 'lucide-react';
import { useId, type Ref } from 'react';
import { RiskNote } from '@/components/product/risk-note';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { t } from '@/i18n';
import { KeySlot } from '@/pages/app/KeySlot';
import { StepButtons } from './StepButtons.tsx';
import type { Blocker, SecondKeyProblem } from './wizard.ts';

type SecondKeyStepProps = {
  headingRef: Ref<HTMLHeadingElement>;
  mainKey: Address;
  /** Both keys are accounts of this wallet (its name), or null. */
  sameWallet: string | null;
  problems: readonly SecondKeyProblem[];
  seedConfirmed: boolean;
  blockers: readonly Blocker[];
  onSeed: (value: boolean) => void;
  onLeaveOut: (account: Address) => void;
  onBack: () => void;
  onContinue: () => void;
};

/**
 * Step 2 (F1 step 2): connect the second key in this browser. The risks come before the signature (UX rule 6): the
 * second key can freeze the stake, and both keys from one seed phrase protect nothing, which the user confirms.
 */
export function SecondKeyStep(props: SecondKeyStepProps) {
  const { headingRef, mainKey, sameWallet, problems } = props;
  const headingId = useId();
  const seedId = useId();
  const hintId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-2xl font-semibold">
          {t('protect.second.heading')}
        </h2>
        <p className="max-w-prose text-muted">{t('protect.second.body')}</p>
      </div>
      <KeySlot role="second" mainKey={mainKey} description={t('protect.second.slotDescription')} />
      <p className="max-w-prose text-sm text-muted">{t('protect.second.oneBrowser')}</p>
      {sameWallet === null ? null : (
        <Alert tone="info" role="note">
          <InfoIcon aria-hidden="true" />
          <AlertDescription className="text-foreground">{t('protect.second.sameWallet', { wallet: sameWallet })}</AlertDescription>
        </Alert>
      )}
      <RiskNote risk="second-key-can-freeze" />
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
      <StepButtons blockers={props.blockers} onContinue={props.onContinue} onBack={props.onBack} />
    </section>
  );
}
