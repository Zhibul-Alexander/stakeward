import { t } from '@/i18n';

// Devnet-only page: two wallets co-sign one SetLockupChecked (CLAUDE.md section 10, step 3). Loaded lazily from
// routes.tsx behind IS_DEVNET, so the mainnet bundle does not contain it (test/build-output.test.ts).
export const DEV_COSIGN_MARKER = 'stakeward-dev-only:dev-cosign';

export default function DevCosignPage() {
  return (
    <div data-marker={DEV_COSIGN_MARKER} className="flex flex-col gap-4">
      <h1 className="text-3xl font-semibold">{t('devCosign.title')}</h1>
    </div>
  );
}
