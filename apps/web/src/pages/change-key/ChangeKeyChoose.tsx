import type { Address } from '@solana/kit';
import { TriangleAlertIcon } from 'lucide-react';
import { useId, type Ref } from 'react';
import { Link } from 'wouter';
import { RiskNote } from '@/components/product/risk-note';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { t } from '@/i18n';
import type { LoadedAccount } from '@/pages/account/AccountView';
import { KeySlot } from '@/pages/app/KeySlot';
import { appLinks } from '@/pages/app/view';
import { ContinueButtons } from '@/pages/protect/StepButtons';
import { SameWalletWarning, type SameWallet } from '@/pages/rescue/SameWalletWarning';
import { useWallets, useWalletSlots } from '@/ports';
import { changeKeyStage, newKeyProblems } from './plan.ts';

type ChangeKeyChooseProps = {
  headingRef: Ref<HTMLHeadingElement>;
  loaded: LoadedAccount;
  seedConfirmed: boolean;
  onSeed: (value: boolean) => void;
  onContinue: (newKey: Address) => void;
};

/**
 * What /change-key/:account offers for the lock as just read (F7): connect a new wallet from a new seed phrase as the
 * new second key, with the risks said above the button; or, when no second key holds a lock now, why there is nothing
 * to hand on and the way to protect the stake instead.
 */
export function ChangeKeyChoose({ headingRef, loaded, seedConfirmed, onSeed, onContinue }: ChangeKeyChooseProps) {
  const headingId = useId();
  const seedId = useId();
  const slots = useWalletSlots();
  const wallets = useWallets();
  const { account, clock } = loaded;
  const { lockup } = account;
  if (changeKeyStage(account, clock) !== 'ready') {
    return (
      <div className="flex flex-col items-start gap-3" data-slot="change-key-not-locked">
        <p className="max-w-prose">{t('changeKey.notLocked')}</p>
        <Button asChild>
          <Link href={appLinks.protect([account.address])}>{t('changeKey.protect')}</Link>
        </Button>
      </div>
    );
  }
  const newKey = slots.new?.address ?? null;
  const problems = newKey === null ? [] : newKeyProblems(newKey, account);
  // The new key's wallet app also holds the main key or the second key: probably one seed phrase (SECURITY-CHECK П5).
  const fresh = slots.new;
  const shared =
    fresh === null
      ? []
      : (['main', 'second'] as const).filter((role) => {
          const slot = slots[role];
          const key = role === 'main' ? account.withdrawer : lockup.custodian;
          return slot !== null && slot.walletId === fresh.walletId && slot.address === key;
        });
  const walletName = fresh === null ? null : (wallets.find((wallet) => wallet.id === fresh.walletId)?.name ?? null);
  const sameWallet: SameWallet | null = shared.length > 0 && walletName !== null ? { wallet: walletName, roles: shared } : null;
  const blockers = [
    ...(newKey === null ? [t('changeKey.needNew')] : []),
    ...(problems.length > 0 ? [t('changeKey.fixProblem')] : []),
    ...(seedConfirmed ? [] : [t('changeKey.needSeedCheck')]),
  ];
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold">
          {t('changeKey.heading')}
        </h2>
        <p className="max-w-prose text-pretty">{t('changeKey.body')}</p>
        <p className="max-w-prose text-sm text-pretty text-muted">{t('changeKey.newSeed')}</p>
      </div>
      {/* Connecting is this step's main action until the new key is here (DECISIONS.md D112). */}
      <KeySlot
        role="new"
        mainKey={account.withdrawer}
        description={t('changeKey.slot')}
        emphasis={newKey === null ? 'primary' : 'outline'}
      />
      {sameWallet === null ? null : <SameWalletWarning sameWallet={sameWallet} action="continue" />}
      {problems.length === 0 ? null : (
        <Alert tone="danger" role="note" data-slot="new-key-problems">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription className="flex flex-col gap-1 text-foreground">
            {problems.map((problem) => (
              <p key={problem} className="font-medium">
                {t(`changeKey.problem.${problem}`)}
              </p>
            ))}
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col gap-2">
        <RiskNote risk="lose-second-key" date={lockup.unixTimestamp} variant="inline" />
        <RiskNote risk="second-key-can-freeze" variant="inline" />
      </div>
      {/* The seed check right above the button it unlocks. */}
      <div className="flex items-start gap-3">
        <Checkbox
          id={seedId}
          checked={seedConfirmed}
          className="mt-0.5"
          onCheckedChange={(value) => {
            onSeed(value === true);
          }}
        />
        <Label htmlFor={seedId}>{t('changeKey.seedCheck')}</Label>
      </div>
      <ContinueButtons
        label={t('changeKey.review')}
        problems={blockers}
        onContinue={() => {
          if (newKey !== null && blockers.length === 0) onContinue(newKey);
        }}
      />
    </section>
  );
}
