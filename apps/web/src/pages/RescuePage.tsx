import { Page } from '@/components/layout/Page';
import type { SigningTestOptions } from '@/signing/create';
import { RescueWizard } from './rescue/RescueWizard.tsx';

type RescuePageProps = {
  /** Tests poll and re-read faster; the product uses the engine's defaults. */
  signing?: SigningTestOptions | undefined;
};

/**
 * /rescue (F4): the main key may be stolen, so the stake moves to a new wallet with the second key's co-signature.
 * The first step says what is safe and what is not before anything is asked. Works from `?address=<main key>` (the
 * Telegram alert's "Open Rescue") with no wallet connected. The wizard owns the page header: its steps sit in it.
 */
export function RescuePage({ signing }: RescuePageProps) {
  return (
    <Page width="flow">
      <RescueWizard signing={signing} />
    </Page>
  );
}
