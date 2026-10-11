import { isAddress, type Address } from '@solana/kit';
import { formatSol, shortAddress, type ValidatorRisk } from '@stakeward/core';
import { LoaderCircleIcon, ShuffleIcon, TriangleAlertIcon } from 'lucide-react';
import { useId, useState, type Ref } from 'react';
import { Link } from 'wouter';
import { ActionBar } from '@/components/product/action-bar';
import { EmptyState } from '@/components/product/empty-state';
import { ErrorState } from '@/components/product/error-state';
import { RadioCardGroup, type RadioCardOption } from '@/components/product/radio-card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLoad } from '@/hooks/use-load';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import type { LoadedAccount } from '@/pages/account/AccountView';
import { appLinks } from '@/pages/app/view';
import { useValidators, type ValidatorChoice } from '@/ports';
import { delegateStage } from './plan.ts';

const LAMPORTS_PER_SOL = 1_000_000_000n;

/** How many validators one offer shows. */
export const OFFER_SIZE = 8;

const PASTE = 'paste';

type DelegateChooseProps = {
  headingRef: Ref<HTMLHeadingElement>;
  loaded: LoadedAccount;
  onContinue: (voteAccount: Address) => void;
};

function validatorOption(choice: ValidatorChoice): RadioCardOption {
  return {
    value: choice.voteAccount,
    title: t('delegate.validator', { address: shortAddress(choice.voteAccount) }),
    meta: t('delegate.validatorMeta', { commission: String(choice.commission), stake: formatSol(choice.activatedStake - (choice.activatedStake % LAMPORTS_PER_SOL)) }),
  };
}

/**
 * What /delegate/:account offers for the account as just read (DECISIONS.md D134): validators that meet open criteria,
 * in random order, with "no paid placement" said above them, or a vote account the person pastes, checked by the same
 * rules; or why this account cannot be delegated here and the way on.
 */
export function DelegateChoose({ headingRef, loaded, onContinue }: DelegateChooseProps) {
  const headingId = useId();
  const pasteId = useId();
  const validators = useValidators();
  const [round, setRound] = useState(0);
  const offer = useLoad(`offer#${String(round)}`, () => validators.offer(OFFER_SIZE));
  const [chosen, setChosen] = useState<string>('');
  const [pasted, setPasted] = useState('');
  const pastedAddress = pasted.trim();
  const pastedValid = isAddress(pastedAddress);
  const check = useLoad<ValidatorRisk[]>(chosen === PASTE && pastedValid ? `risks#${pastedAddress}` : null, () =>
    validators.risks(pastedAddress as Address),
  );
  const { account, clock } = loaded;
  const stage = delegateStage(account, clock);

  if (stage !== 'ready') {
    return (
      <div className="flex flex-col items-start gap-3" data-slot="delegate-not-ready">
        <p className="max-w-prose">{t(`delegate.stage.${stage}`)}</p>
        <Button asChild variant="outline">
          <Link href={`/app?${new URLSearchParams({ address: account.withdrawer }).toString()}`}>{t('common.backToAccounts')}</Link>
        </Button>
      </div>
    );
  }

  const offered = offer.status === 'ready' ? offer.value : [];
  const options: RadioCardOption[] = [
    ...offered.map(validatorOption),
    { value: PASTE, title: t('delegate.paste'), description: t('delegate.pasteHint') },
  ];
  const vote: Address | null =
    chosen === PASTE
      ? pastedValid && check.status === 'ready' && check.value.length === 0
        ? pastedAddress
        : null
      : offered.some((choice) => choice.voteAccount === chosen)
        ? (chosen as Address)
        : null;
  const risks = chosen === PASTE && check.status === 'ready' ? check.value : [];

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold">
          {t('delegate.heading')}
        </h2>
        <p className="max-w-prose text-pretty">{t('delegate.body')}</p>
        {/* The criteria are open and the order is random: Stakeward recommends no validator and sells no place. */}
        <p data-slot="no-paid-placement" className="max-w-prose text-sm text-pretty text-muted">
          {t('delegate.criteria')}
        </p>
      </div>
      {offer.status === 'loading' || offer.status === 'idle' ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
          {t('delegate.loading')}
        </p>
      ) : offer.status === 'error' ? (
        <ErrorState
          title={t('delegate.loadError')}
          message={errorMessage(offer.error)}
          detail={offer.error.detail}
          onRetry={() => {
            setRound((value) => value + 1);
          }}
        />
      ) : offered.length === 0 ? (
        <EmptyState title={t('delegate.empty.title')} headingLevel={3}>
          {t('delegate.empty.body')}
        </EmptyState>
      ) : null}
      <RadioCardGroup legend={t('delegate.legend')} value={chosen} onValueChange={setChosen} options={options} />
      {offer.status === 'ready' ? (
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setChosen((value) => (value === PASTE ? value : ''));
              setRound((value) => value + 1);
            }}
          >
            <ShuffleIcon aria-hidden="true" />
            {t('delegate.shuffle')}
          </Button>
        </div>
      ) : null}
      {chosen === PASTE ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={pasteId}>{t('delegate.pasteLabel')}</Label>
          <Input
            id={pasteId}
            value={pasted}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={pastedAddress !== '' && (!pastedValid || risks.length > 0)}
            onChange={(event) => {
              setPasted(event.target.value);
            }}
          />
          {pastedAddress !== '' && !pastedValid ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {t('delegate.pasteInvalid')}
            </p>
          ) : null}
          {pastedValid && check.status === 'loading' ? (
            <p role="status" className="flex items-center gap-2 text-sm text-muted">
              <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
              {t('delegate.checking')}
            </p>
          ) : null}
          {check.status === 'error' ? <ErrorState title={t('delegate.checkError')} message={errorMessage(check.error)} detail={check.error.detail} /> : null}
          {risks.length === 0 ? null : (
            <Alert tone="danger" role="note" data-slot="validator-risks">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertDescription className="flex flex-col gap-1 text-foreground">
                <p className="font-medium">{t('delegate.risky')}</p>
                {risks.map((risk) => (
                  <p key={risk}>{t(`delegate.risks.${risk}`)}</p>
                ))}
              </AlertDescription>
            </Alert>
          )}
        </div>
      ) : null}
      <ActionBar
        note={t('delegate.note')}
        primary={
          <Button
            disabled={vote === null}
            onClick={() => {
              if (vote !== null) onContinue(vote);
            }}
          >
            {t('delegate.review')}
          </Button>
        }
        secondary={
          <Button asChild variant="ghost">
            <Link href={appLinks.withdraw(account.address)}>{t('delegate.withdrawInstead')}</Link>
          </Button>
        }
      />
    </section>
  );
}
