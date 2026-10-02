import { ArrowLeftIcon } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

/** Placeholder for routes built in later steps; always offers a way back (UX rule 7: no dead ends). */
export function ComingSoonPage({ title }: { title: string }) {
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-3xl font-semibold">{title}</h1>
      <p className="text-muted">{t('common.comingSoonBody')}</p>
      <div>
        <Button asChild variant="outline">
          <Link href="/app">
            <ArrowLeftIcon aria-hidden="true" />
            {t('common.backToAccounts')}
          </Link>
        </Button>
      </div>
    </div>
  );
}
