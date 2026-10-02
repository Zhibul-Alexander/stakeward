import { ArrowLeftIcon } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

export function NotFoundPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-3xl font-semibold">{t('common.notFoundTitle')}</h1>
      <p className="text-muted">{t('common.notFoundBody')}</p>
      <div>
        <Button asChild variant="outline">
          <Link href="/">
            <ArrowLeftIcon aria-hidden="true" />
            {t('common.backHome')}
          </Link>
        </Button>
      </div>
    </div>
  );
}
