import { ChevronRightIcon } from 'lucide-react';
import { Link } from 'wouter';
import { t } from '@/i18n';
import { LEARN_TABS } from '../LearnPage.tsx';

/** The way from the short landing page to the details (/learn): one link per tab, each with one line on what it answers. */
export function LearnMore() {
  return (
    <section aria-labelledby="learn-more-title" className="flex flex-col gap-5">
      <h2 id="learn-more-title" className="text-2xl text-balance sm:text-3xl">
        {t('landing.learnMore.title')}
      </h2>
      <ul role="list" className="grid border-t border-border sm:grid-cols-2 sm:gap-x-10">
        {LEARN_TABS.map((id) => (
          <li key={id} className="border-b border-border">
            <Link href={`/learn/${id}`} className="group flex items-center justify-between gap-3 rounded-sm py-4 hover:text-primary">
              <span className="flex flex-col gap-0.5">
                <span className="text-base font-semibold">{t(`learn.tabs.${id}`)}</span>
                <span className="text-sm text-muted">{t(`landing.learnMore.${id}`)}</span>
              </span>
              <ChevronRightIcon aria-hidden="true" className="size-5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
