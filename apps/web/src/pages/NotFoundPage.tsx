import { Link } from 'wouter';
import { Page } from '@/components/layout/Page';
import { PageHeader } from '@/components/layout/PageHeader';
import { ActionBar } from '@/components/product/action-bar';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

/**
 * A page that does not exist. Most visitors here followed a link: a broken signing link gets a word of its own, and
 * the way on is checking one's stake, with the start page as the alternative.
 */
export function NotFoundPage() {
  return (
    <Page width="flow">
      <PageHeader title={t('common.notFoundTitle')} lead={t('common.notFoundBody')} meta={<p className="text-pretty">{t('common.notFoundLink')}</p>} />
      <ActionBar
        primary={
          <Button asChild>
            <Link href="/app">{t('common.notFoundAction')}</Link>
          </Button>
        }
        secondary={
          <Button asChild variant="ghost">
            <Link href="/">{t('common.goHome')}</Link>
          </Button>
        }
      />
    </Page>
  );
}
