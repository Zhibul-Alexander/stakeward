import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

/** The closing call to look first. An outline button: the page keeps one primary button, in the hero (spec L16). */
export function FinalCta() {
  return (
    <section
      aria-labelledby="cta-title"
      className="flex flex-col items-start gap-3 rounded-lg bg-subtle p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-6"
    >
      <div className="flex max-w-prose flex-col gap-1">
        <h2 id="cta-title" className="text-lg font-semibold">
          {t('landing.cta.title')}
        </h2>
        <p className="text-sm text-pretty text-muted">{t('landing.cta.body')}</p>
      </div>
      <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
        <Link href="/app">{t('landing.checkStake')}</Link>
      </Button>
    </section>
  );
}
