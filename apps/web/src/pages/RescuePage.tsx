import { t } from '@/i18n';
import type { SigningTestOptions } from '@/signing/create';
import { RescueWizard } from './rescue/RescueWizard.tsx';

type RescuePageProps = {
  /** Tests poll and re-read faster; the product uses the engine's defaults. */
  signing?: SigningTestOptions | undefined;
};

/**
 * /rescue (F4): the main key may be stolen, so the stake moves to a new wallet with the second key's co-signature.
 * The reassurance comes first: while the lock holds, nobody can withdraw it or take it over without the second key.
 * Works from `?address=<main key>` (the Telegram alert's "Open Rescue") with no wallet connected.
 */
export function RescuePage({ signing }: RescuePageProps) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex max-w-2xl flex-col gap-2">
        <h1 className="text-3xl font-semibold">{t('common.pages.rescue')}</h1>
        <p className="text-muted">{t('rescue.intro')}</p>
        <p className="text-sm text-muted">{t('rescue.desktop')}</p>
        <p className="text-sm font-medium">{t('common.neverSeedPhrase')}</p>
      </div>
      <RescueWizard signing={signing} />
    </div>
  );
}
