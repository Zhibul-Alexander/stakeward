import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

/**
 * Variant v3: the last page of the story. The call to look first in the display serif, centred like a closing line,
 * with an outline button (the page keeps one primary button, on the cover).
 */
export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="flex flex-col items-center gap-5 border-t-[3px] border-rule pt-12 text-center sm:pt-16">
      <span aria-hidden="true" className="font-display text-[2rem] leading-none text-accent">
        ∎
      </span>
      <h2 id="cta-title" className="text-[2.75rem] leading-[1] tracking-[-0.02em] text-balance sm:text-[4.5rem]">
        {t('landing.cta.title')}
      </h2>
      <p className="max-w-[32rem] text-lg text-pretty text-muted">{t('landing.cta.body')}</p>
      <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
        <Link href="/app">{t('landing.checkStake')}</Link>
      </Button>
    </section>
  );
}
