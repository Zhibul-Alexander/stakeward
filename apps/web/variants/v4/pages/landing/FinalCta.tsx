import { SearchIcon } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

/** The closing call to look first. An outline button: the page keeps one primary button, in the hero (spec L16). */
export function FinalCta() {
  return (
    <section
      aria-labelledby="cta-title"
      className="flex flex-col items-center gap-4 rounded-2xl bg-primary-soft p-6 text-center sm:p-10"
    >
      <span aria-hidden="true" className="flex size-16 items-center justify-center rounded-full bg-surface text-primary shadow-md">
        <SearchIcon className="size-7" />
      </span>
      <div className="flex max-w-prose flex-col gap-1">
        <h2 id="cta-title" className="text-2xl">
          {t('landing.cta.title')}
        </h2>
        <p className="text-base text-pretty text-muted">{t('landing.cta.body')}</p>
      </div>
      <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
        <Link href="/app">{t('landing.checkStake')}</Link>
      </Button>
    </section>
  );
}
