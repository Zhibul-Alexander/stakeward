import { isAddress, type Address } from '@solana/kit';
import { formatSol, shortAddress, type ValidatorRisk } from '@stakeward/core';
import { LoaderCircleIcon, ShuffleIcon, TriangleAlertIcon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
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
import { useValidators, type ValidatorChoice } from '@/ports';

const LAMPORTS_PER_SOL = 1_000_000_000n;

/** How many validators one offer shows. */
export const OFFER_SIZE = 8;

const PASTE = 'paste';

function validatorOption(choice: ValidatorChoice): RadioCardOption {
  return {
    value: choice.voteAccount,
    title: t('delegate.validator', { address: shortAddress(choice.voteAccount) }),
    meta: t('delegate.validatorMeta', { commission: String(choice.commission), stake: formatSol(choice.activatedStake - (choice.activatedStake % LAMPORTS_PER_SOL)) }),
  };
}

/**
 * The validator choice of /delegate and /stake (DECISIONS.md D134): validators that meet open criteria, in random
 * order, or a vote account the person pastes, checked by the same rules. `vote` is the chosen vote account once it is
 * usable (null until then). With `preselect` the first validator of each offer is chosen until the person picks one
 * (D138: /stake starts with a validator chosen, the order is still random).
 */
export function useValidatorPicker(options: { preselect?: boolean } = {}): { vote: Address | null; picker: ReactNode } {
  const pasteId = useId();
  const validators = useValidators();
  const [round, setRound] = useState(0);
  const offer = useLoad(`offer#${String(round)}`, () => validators.offer(OFFER_SIZE));
  const [picked, setChosen] = useState<string>('');
  const [pasted, setPasted] = useState('');
  const pastedAddress = pasted.trim();
  const pastedValid = isAddress(pastedAddress);
  const offered = offer.status === 'ready' ? offer.value : [];
  const chosen = picked === '' && options.preselect === true ? (offered[0]?.voteAccount ?? '') : picked;
  const check = useLoad<ValidatorRisk[]>(chosen === PASTE && pastedValid ? `risks#${pastedAddress}` : null, () =>
    validators.risks(pastedAddress as Address),
  );

  const radioOptions: RadioCardOption[] = [
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

  const picker = (
    <>
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
      <RadioCardGroup legend={t('delegate.legend')} value={chosen} onValueChange={setChosen} options={radioOptions} />
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
    </>
  );
  return { vote, picker };
}
