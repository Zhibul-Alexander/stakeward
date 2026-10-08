import { ArrowLeftIcon } from 'lucide-react';
import { Link } from 'wouter';
import { Page } from '@/components/layout/Page';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

export function NotFoundPage() {
  return (
    <Page width="flow">
      <PageHeader title={t('common.notFoundTitle')} lead={t('common.notFoundBody')} />
      <div>
        <Button asChild variant="outline">
          <Link href="/">
            <ArrowLeftIcon aria-hidden="true" />
            {t('common.backHome')}
          </Link>
        </Button>
      </div>
    </Page>
  );
}
