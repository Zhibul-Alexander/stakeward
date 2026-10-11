import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

/** v8: the closing call, on the checklist's dark band. Outline-weight: the page keeps its one filled button in the hero. */
export function FinalCta() {
  return (
    <section
      aria-labelledby="cta-title"
      className="flex flex-col items-start gap-4 rounded-lg bg-band p-5 text-on-band sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-8"
    >
      <div className="flex max-w-prose flex-col gap-1">
        <h2 id="cta-title" className="text-2xl">
          {t('landing.cta.title')}
        </h2>
        <p className="text-sm text-pretty text-band-muted sm:text-base">{t('landing.cta.body')}</p>
      </div>
      <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
        <Link href="/app">{t('landing.checkStake')}</Link>
      </Button>
    </section>
  );
}
