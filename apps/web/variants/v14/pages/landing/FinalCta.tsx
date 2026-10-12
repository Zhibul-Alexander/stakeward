import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

/** The closing call: look at your own stake, the same way the record looks at the test accounts. Outline: the hero keeps the one primary button. */
export function FinalCta() {
  return (
    <section
      aria-labelledby="cta-title"
      className="flex flex-col items-start gap-4 rounded-lg border border-border-strong bg-surface p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8 sm:p-8"
    >
      <div className="flex max-w-prose flex-col gap-1.5">
        <h2 id="cta-title" className="text-2xl text-balance">
          Now read your own stake from the network
        </h2>
        <p className="text-base text-pretty text-muted">{t('landing.cta.body')}</p>
      </div>
      <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
        <Link href="/app">{t('landing.checkStake')}</Link>
      </Button>
    </section>
  );
}
