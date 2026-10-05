import { t } from '@/i18n';
import { useWalletSlots } from '@/ports';
import type { SigningTestOptions } from '@/signing/create';
import { ProtectWizard } from './protect/ProtectWizard.tsx';

type ProtectPageProps = {
  /** Tests poll and re-read faster; the product uses the engine's defaults. */
  signing?: SigningTestOptions | undefined;
};

/**
 * /protect: the protect wizard (F1). The selection lives in the URL (`?account=` repeated, from /app or a link); a
 * reload starts again from it and reads everything fresh. Another main key starts the wizard over, the URL stays.
 */
export function ProtectPage({ signing }: ProtectPageProps) {
  const mainKey = useWalletSlots().main?.address ?? null;
  return (
    <div className="flex flex-col gap-8">
      <div className="flex max-w-2xl flex-col gap-2">
        <h1 className="text-3xl font-semibold">{t('common.pages.protect')}</h1>
        <p className="text-muted">{t('protect.intro')}</p>
      </div>
      <ProtectWizard key={mainKey ?? 'none'} mainKey={mainKey} signing={signing} />
    </div>
  );
}
