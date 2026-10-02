import { t } from '@/i18n';

/** /app: stake accounts and their status, also by address without a wallet (/app?address=). Built in step 3. */
export function AppPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-semibold">{t('app.title')}</h1>
      <p className="text-muted">{t('common.comingSoon')}</p>
    </div>
  );
}
