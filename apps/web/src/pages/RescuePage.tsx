import { Page } from '@/components/layout/Page';
import { PageHeader } from '@/components/layout/PageHeader';
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
    <Page width="flow">
      <PageHeader
        title={t('common.pages.rescue')}
        lead={t('rescue.intro')}
        meta={
          <>
            <p>{t('rescue.desktop')}</p>
            <p>{t('common.neverSeedPhrase')}</p>
          </>
        }
      />
      <RescueWizard signing={signing} />
    </Page>
  );
}
