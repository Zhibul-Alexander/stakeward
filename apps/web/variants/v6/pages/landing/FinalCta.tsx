import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

/** The closing call to look first: big type, one outline button (the hero keeps the page's one filled button). */
export function FinalCta() {
  return (
    <section
      aria-labelledby="cta-title"
      className="flex flex-col items-start gap-5 border-[3px] border-foreground p-5 sm:flex-row sm:items-end sm:justify-between sm:gap-8 sm:p-8"
    >
      <div className="flex max-w-prose flex-col gap-2">
        <h2 id="cta-title" className="text-3xl uppercase sm:text-4xl">
          {t('landing.cta.title')}
        </h2>
        <p className="text-base text-pretty">{t('landing.cta.body')}</p>
      </div>
      <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
        <Link href="/app">{t('landing.checkStake')}</Link>
      </Button>
    </section>
  );
}
