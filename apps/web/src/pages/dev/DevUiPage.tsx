import { t } from '@/i18n';

// Devnet-only page: tokens and every component in every state (CLAUDE.md section 9). Loaded lazily from
// routes.tsx behind IS_DEVNET, so the mainnet bundle does not contain it (test/build-output.test.ts).
export const DEV_UI_MARKER = 'stakeward-dev-only:dev-ui';

export default function DevUiPage() {
  return (
    <div data-marker={DEV_UI_MARKER} className="flex flex-col gap-4">
      <h1 className="text-3xl font-semibold">{t('devUi.title')}</h1>
    </div>
  );
}
