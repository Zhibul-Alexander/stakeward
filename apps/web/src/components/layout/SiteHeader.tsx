import { Link } from 'wouter';
import { Badge } from '@/components/ui/badge';
import { IS_DEVNET } from '@/config';
import { t } from '@/i18n';

export function SiteHeader() {
  return (
    <header className="border-b border-border bg-surface print:hidden">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-2">
          <Link href="/" className="rounded-sm text-lg font-semibold" aria-label={t('nav.home')}>
            {t('common.appName')}
          </Link>
          {IS_DEVNET ? (
            <Badge tone="warning" title={t('common.devnetNote')}>
              {t('common.devnet')}
            </Badge>
          ) : null}
        </div>
        <nav aria-label={t('nav.label')}>
          <Link
            href="/app"
            className="rounded-sm text-sm font-medium text-primary underline-offset-4 hover:text-primary-hover hover:underline"
          >
            {t('nav.app')}
          </Link>
        </nav>
      </div>
    </header>
  );
}
