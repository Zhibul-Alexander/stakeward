import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

/** v10 closing call: an inverse blueprint band. Outline button: the page keeps one filled button, in the hero. */
export function FinalCta() {
  return (
    <section
      aria-labelledby="cta-title"
      className="flex flex-col items-start gap-4 rounded-lg bg-inverse bg-blueprint-inverse p-5 text-on-inverse sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-8"
    >
      <div className="flex max-w-prose flex-col gap-1">
        <h2 id="cta-title" className="font-display text-2xl">
          {t('landing.cta.title')}
        </h2>
        <p className="text-sm text-pretty opacity-90 sm:text-base">{t('landing.cta.body')}</p>
      </div>
      <Button asChild size="lg" variant="outline" className="w-full border-on-inverse bg-transparent text-on-inverse hover:bg-on-inverse hover:text-inverse sm:w-auto">
        <Link href="/app">{t('landing.checkStake')}</Link>
      </Button>
    </section>
  );
}
