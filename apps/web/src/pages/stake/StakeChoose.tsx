import type { Address } from '@solana/kit';
import { STAKE_ACCOUNT_SIZE } from '@stakeward/core';
import { LoaderCircleIcon } from 'lucide-react';
import { useId, useState, type Ref } from 'react';
import { ActionBar } from '@/components/product/action-bar';
import { ErrorState } from '@/components/product/error-state';
import { SolAmount } from '@/components/product/sol-amount';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLoad } from '@/hooks/use-load';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { useValidatorPicker } from '@/pages/delegate/ValidatorPicker';
import { usePorts } from '@/ports';
import { FEE_RESERVE_LAMPORTS, MIN_STAKE_LAMPORTS, parseSolAmount, solInputText } from './plan.ts';

type StakeChooseProps = {
  headingRef: Ref<HTMLHeadingElement>;
  mainKey: Address;
  /** The amount of the last run, so Back keeps what was typed (UX rule 2). */
  initialAmount: string;
  /** `lamports` is what moves into the account: the amount plus the rent-exempt reserve. */
  onContinue: (input: { amount: string; lamports: bigint; voteAccount: Address }) => void;
};

/**
 * What /stake asks before signing (D138): how much SOL of the main key to stake and with which validator. The wallet
 * balance and the account's rent-exempt reserve are read from the chain; "Max" leaves a little for fees. A validator
 * is chosen at the start (random order, open criteria); the person can pick another or paste one.
 */
export function StakeChoose({ headingRef, mainKey, initialAmount, onContinue }: StakeChooseProps) {
  const headingId = useId();
  const amountId = useId();
  const hintId = useId();
  const { chain } = usePorts();
  const [attempt, setAttempt] = useState(0);
  const funds = useLoad(`funds#${mainKey}#${String(attempt)}`, async () => {
    const [balance, rent] = await Promise.all([
      chain.getBalance(mainKey),
      chain.getMinimumBalanceForRentExemption(STAKE_ACCOUNT_SIZE),
    ]);
    return { balance, rent };
  });
  const [amount, setAmount] = useState(initialAmount);
  const { vote, picker } = useValidatorPicker({ preselect: true });

  const lamports = parseSolAmount(amount);
  const ready = funds.status === 'ready' ? funds.value : null;
  const max = ready === null ? null : ready.balance - ready.rent - FEE_RESERVE_LAMPORTS;
  const problem =
    amount.trim() === ''
      ? null
      : lamports === null
        ? t('stake.amountInvalid')
        : lamports < MIN_STAKE_LAMPORTS
          ? t('stake.amountTooSmall', { amount: solInputText(MIN_STAKE_LAMPORTS) })
          : max !== null && lamports > max
            ? t('stake.amountTooLarge')
            : null;
  const canContinue = ready !== null && lamports !== null && problem === null && vote !== null;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold">
          {t('stake.heading')}
        </h2>
        <p className="max-w-prose text-pretty">{t('stake.body')}</p>
      </div>
      {funds.status === 'error' ? (
        <ErrorState
          title={t('stake.balanceError')}
          message={errorMessage(funds.error)}
          detail={funds.error.detail}
          onRetry={() => {
            setAttempt((value) => value + 1);
          }}
        />
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor={amountId}>{t('stake.amountLabel')}</Label>
        <div className="flex gap-2">
          <Input
            id={amountId}
            value={amount}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="1"
            aria-describedby={hintId}
            aria-invalid={problem !== null}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
          />
          <Button
            variant="outline"
            disabled={max === null || max < MIN_STAKE_LAMPORTS}
            onClick={() => {
              if (max !== null) setAmount(solInputText(max));
            }}
          >
            {t('stake.max')}
          </Button>
        </div>
        <p id={hintId} className="flex flex-wrap items-center gap-x-1 text-sm text-muted">
          {ready === null ? (
            funds.status === 'error' ? null : (
              <>
                <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
                {t('stake.balanceLoading')}
              </>
            )
          ) : (
            <>
              <span>{t('stake.balance')}</span>
              <SolAmount lamports={ready.balance} />
              <span>{t('stake.reserve', { amount: solInputText(ready.rent) })}</span>
            </>
          )}
        </p>
        {problem === null ? null : (
          <p role="alert" className="text-sm font-medium text-danger">
            {problem}
          </p>
        )}
      </div>
      {picker}
      <ActionBar
        note={t('stake.note')}
        primary={
          <Button
            disabled={!canContinue}
            onClick={() => {
              if (canContinue) onContinue({ amount, lamports: lamports + ready.rent, voteAccount: vote });
            }}
          >
            {t('stake.review')}
          </Button>
        }
      />
    </section>
  );
}
