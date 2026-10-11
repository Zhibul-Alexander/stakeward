import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

/**
 * The closing call: which future is your stake in? Split again, night to day, with the look-first button on the day
 * side. Outline, so the page keeps one filled button (in the hero).
 */
export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="relative isolate">
      <div aria-hidden="true" className="absolute inset-y-0 left-0 -z-10 hidden w-1/2 bg-night md:block" />
      <div aria-hidden="true" className="absolute inset-y-0 right-0 -z-10 hidden w-1/2 bg-day md:block" />
      <div aria-hidden="true" className="absolute inset-y-0 left-1/2 -z-10 hidden w-0.5 -translate-x-1/2 bg-clock md:block" />
      <div className="mx-auto grid w-full max-w-6xl md:grid-cols-futures md:px-4">
        <div className="scope-night flex flex-col justify-center gap-2 px-4 py-10 md:bg-transparent md:py-16 md:pr-10 md:pl-0">
          <h2 id="cta-title" className="text-2xl text-balance sm:text-3xl">
            Which future is your stake in?
          </h2>
        </div>
        <div aria-hidden="true" className="hidden md:block" />
        <div className="scope-day flex flex-col items-start justify-center gap-4 px-4 py-10 md:bg-transparent md:py-16 md:pr-0 md:pl-10">
          <p className="max-w-md text-base text-pretty">{t('landing.cta.body')}</p>
          <Button asChild size="lg" variant="outline">
            <Link href="/app">{t('landing.checkStake')}</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
