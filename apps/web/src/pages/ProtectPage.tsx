import { Page } from '@/components/layout/Page';
import { useWalletSlots } from '@/ports';
import type { SigningTestOptions } from '@/signing/create';
import { ProtectWizard } from './protect/ProtectWizard.tsx';

type ProtectPageProps = {
  /** Tests poll and re-read faster; the product uses the engine's defaults. */
  signing?: SigningTestOptions | undefined;
};

/**
 * /protect: the protect wizard (F1), which heads the page itself (its lead and progress follow the step). The selection
 * lives in the URL (`?account=` repeated, from /app or a link); a reload starts again from it and reads everything
 * fresh. Another main key starts the wizard over, the URL stays.
 */
export function ProtectPage({ signing }: ProtectPageProps) {
  const mainKey = useWalletSlots().main?.address ?? null;
  return (
    <Page width="flow">
      <ProtectWizard key={mainKey ?? 'none'} mainKey={mainKey} signing={signing} />
    </Page>
  );
}
