import type { Address } from '@solana/kit';
import { useId, type Ref } from 'react';
import { Link } from 'wouter';
import { ActionBar } from '@/components/product/action-bar';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import type { LoadedAccount } from '@/pages/account/AccountView';
import { appLinks } from '@/pages/app/view';
import { delegateStage } from './plan.ts';
import { useValidatorPicker } from './ValidatorPicker.tsx';

export { OFFER_SIZE } from './ValidatorPicker.tsx';

type DelegateChooseProps = {
  headingRef: Ref<HTMLHeadingElement>;
  loaded: LoadedAccount;
  onContinue: (voteAccount: Address) => void;
};

/**
 * What /delegate/:account offers for the account as just read (DECISIONS.md D134): validators that meet open criteria,
 * in random order, with "no paid placement" said above them, or a vote account the person pastes, checked by the same
 * rules; or why this account cannot be delegated here and the way on.
 */
export function DelegateChoose({ headingRef, loaded, onContinue }: DelegateChooseProps) {
  const headingId = useId();
  const { vote, picker } = useValidatorPicker();
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
      {picker}
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
