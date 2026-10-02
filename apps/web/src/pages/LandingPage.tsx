import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

/** Placeholder until step 8 builds the landing page. Keeps the #cannot-do anchor the footer links to. */
export function LandingPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-10">
      <section className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold sm:text-4xl">{t('landing.title')}</h1>
        <p className="text-lg text-muted">{t('landing.body')}</p>
        <div>
          <Button asChild size="lg">
            <Link href="/app">{t('landing.checkStake')}</Link>
          </Button>
        </div>
      </section>
      <section id="cannot-do" aria-labelledby="cannot-do-title" className="flex flex-col gap-3">
        <h2 id="cannot-do-title" className="text-xl font-semibold">
          {t('landing.cannotDoTitle')}
        </h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-muted">
          <li>{t('landing.cannotDo1')}</li>
          <li>{t('landing.cannotDo2')}</li>
          <li>{t('landing.cannotDo3')}</li>
          <li>{t('landing.cannotDo4')}</li>
        </ul>
      </section>
    </div>
  );
}
