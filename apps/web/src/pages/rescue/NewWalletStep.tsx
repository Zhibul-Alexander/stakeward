import type { Address } from '@solana/kit';
import { formatSol } from '@stakeward/core';
import { CircleAlertIcon, CircleCheckIcon, LoaderCircleIcon, RotateCcwIcon, TriangleAlertIcon } from 'lucide-react';
import { useId, useState, type Ref } from 'react';
import { AddressText } from '@/components/product/address-text';
import { keepTogether } from '@/components/product/countdown';
import { ErrorState } from '@/components/product/error-state';
import { QrCode } from '@/components/product/qr-code';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useLoad } from '@/hooks/use-load';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { KeySlot } from '@/pages/app/KeySlot';
import { ContinueButtons } from '@/pages/protect/StepButtons';
import { useChain } from '@/ports';
import { readNonceInfo } from '@/signing/nonce';
import { SameWalletWarning, type SameWallet } from './SameWalletWarning.tsx';
import {
  rescueBlockers,
  rescueMinimum,
  SUGGESTED_RESCUE_LAMPORTS,
  type NewWalletProblem,
  type RescueBlocker,
} from './wizard.ts';

type NewWalletStepProps = {
  headingRef: Ref<HTMLHeadingElement>;
  mainKey: Address;
  /** The new wallet slot's address, once it is ready here. */
  newWallet: Address | null;
  /** The new wallet's wallet app (its name) also holds these keys, or null (SECURITY-CHECK П5). */
  sameWallet: SameWallet | null;
  problems: readonly NewWalletProblem[];
  /** Stake accounts this run moves (each one's fees count). */
  count: number;
  seedConfirmed: boolean;
  onSeed: (value: boolean) => void;
  onBack: () => void;
  onContinue: () => void;
};

/** The new wallet's balance, its link-signing account and the minimum balance a wallet must keep. */
type Funds = { balance: bigint; nonceReady: boolean; nonceDeposit: bigint; rentExempt0: bigint };

/** What the screen says when Continue cannot go on yet. */
function blockerText(blocker: RescueBlocker): string {
  switch (blocker) {
    case 'need-new':
      return t('rescue.newWallet.needNew');
    case 'new-problem':
      return t('rescue.newWallet.fixProblem');
    case 'need-seed-check':
      return t('rescue.newWallet.needSeedCheck');
    case 'balance-loading':
      return t('rescue.newWallet.balanceLoading');
    case 'low-balance':
      return t('rescue.newWallet.lowBalance');
    default:
      return t('errors.unknown');
  }
}

/**
 * Step 2 (F4 step 1): the new wallet D, from a NEW seed phrase. It signs, pays every fee and owns the link-signing
 * account, so its balance is checked before the move, with where to send SOL from (never from the stolen main key).
 * A new wallet in the same wallet app as the main key or the second key gets a warning before the seed box.
 */
export function NewWalletStep(props: NewWalletStepProps) {
  const { headingRef, mainKey, newWallet, sameWallet, problems, count, seedConfirmed } = props;
  const chain = useChain();
  const headingId = useId();
  const seedId = useId();
  const [checks, setChecks] = useState(0);
  const usable = newWallet !== null && problems.length === 0;
  const funds = useLoad<Funds>(usable ? `rescue-funds#${newWallet}#${String(checks)}` : null, async () => {
    const wallet = newWallet as Address;
    const [balance, nonce, rentExempt0] = await Promise.all([
      chain.getBalance(wallet),
      readNonceInfo(chain, wallet),
      chain.getMinimumBalanceForRentExemption(0),
    ]);
    return { balance, nonceReady: nonce.state.kind === 'ready', nonceDeposit: nonce.deposit, rentExempt0 };
  });
  const ready = funds.status === 'ready' ? funds.value : null;
  const needed = ready === null ? null : rescueMinimum({ count, ...ready });
  const blockers = rescueBlockers('new-wallet', {
    mainKey,
    movable: count,
    choices: 0,
    newWallet,
    newProblems: problems.length,
    seedConfirmed,
    balance: ready?.balance ?? null,
    needed,
    secondKey: null,
  });
  const checkAgain = () => {
    setChecks((value) => value + 1);
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold">
          {t('rescue.newWallet.heading')}
        </h2>
        <p className="max-w-prose text-pretty">{t('rescue.newWallet.body')}</p>
      </div>
      {/* Connecting is this step's main action until the new wallet is here (DECISIONS.md D109). */}
      <KeySlot role="new" mainKey={mainKey} description={t('rescue.newWallet.slot')} emphasis={newWallet === null ? 'primary' : 'outline'} />
      {sameWallet === null ? null : <SameWalletWarning sameWallet={sameWallet} action="continue" />}
      {problems.length === 0 ? null : (
        <Alert tone="danger" role="note" data-slot="new-wallet-problems">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription className="flex flex-col gap-1 text-foreground">
            {problems.map((problem) => (
              <p key={problem} className="font-medium">
                {t(`rescue.newWallet.problem.${problem}`)}
              </p>
            ))}
          </AlertDescription>
        </Alert>
      )}
      {newWallet === null || problems.length > 0 ? null : funds.status === 'idle' || funds.status === 'loading' ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
          {t('rescue.newWallet.balanceLoading')}
        </p>
      ) : funds.status === 'error' ? (
        <ErrorState
          title={t('rescue.newWallet.balanceError')}
          message={errorMessage(funds.error)}
          detail={funds.error.detail}
          onRetry={checkAgain}
        />
      ) : ready === null || needed === null ? null : (
        <div data-slot="new-wallet-funds" className="flex flex-col gap-3">
          <p role="status" className="flex items-start gap-2 text-sm tabular-nums">
            {ready.balance >= needed ? (
              <CircleCheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            ) : (
              <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
            )}
            {/* An amount never breaks from its unit ("0.01" / "SOL"). */}
            <span className="text-pretty">
              {t('rescue.newWallet.balance', {
                balance: keepTogether(formatSol(ready.balance)),
                needed: keepTogether(formatSol(needed)),
                suggested: keepTogether(formatSol(needed > SUGGESTED_RESCUE_LAMPORTS ? needed : SUGGESTED_RESCUE_LAMPORTS)),
              })}
            </span>
          </p>
          {ready.balance >= needed ? null : (
            <div className="flex flex-col items-start gap-3 rounded-lg bg-subtle p-4">
              <p className="max-w-prose text-sm">{t('rescue.newWallet.fund')}</p>
              <QrCode value={newWallet} label={t('rescue.newWallet.qr')} />
              <AddressText address={newWallet} variant="full" />
              <Button variant="outline" onClick={checkAgain}>
                <RotateCcwIcon aria-hidden="true" />
                {t('rescue.newWallet.checkBalance')}
              </Button>
            </div>
          )}
        </div>
      )}
      {/* The seed check right above the button it unlocks. */}
      <div className="flex items-start gap-3">
        <Checkbox
          id={seedId}
          checked={seedConfirmed}
          className="mt-0.5"
          onCheckedChange={(value) => {
            props.onSeed(value === true);
          }}
        />
        <Label htmlFor={seedId}>{t('rescue.newWallet.seedCheck')}</Label>
      </div>
      <ContinueButtons label={t('rescue.next.keys')} problems={blockers.map(blockerText)} onContinue={props.onContinue} onBack={props.onBack} />
    </section>
  );
}
