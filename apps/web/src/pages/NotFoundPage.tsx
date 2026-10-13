import { useEffect } from 'react';
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
  // Every path answers 200 with the app (Workers Static Assets, single-page-application), so a crawler cannot tell a
  // missing page by its status: this tag keeps it out of search (DECISIONS D155).
  useEffect(() => {
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex';
    document.head.append(robots);
    return () => {
      robots.remove();
    };
  }, []);

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
