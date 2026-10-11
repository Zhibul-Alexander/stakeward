import { ChevronRightIcon } from 'lucide-react';
import { Link } from 'wouter';
import { t } from '@/i18n';
import { LEARN_TABS } from '../LearnPage.tsx';

/**
 * The way from the short landing page to the details (/learn): one link per tab, each with one line on what it answers.
 */
export function LearnMore() {
  return (
    <section aria-labelledby="learn-more-title" className="flex flex-col gap-3">
      <h2 id="learn-more-title" className="text-2xl text-balance sm:text-3xl lg:text-2xl">
        {t('landing.learnMore.title')}
      </h2>
      <ul role="list" className="grid border-t border-foreground/60 sm:grid-cols-2 sm:gap-x-10">
        {LEARN_TABS.map((id) => (
          <li key={id}>
            <Link
              href={`/learn/${id}`}
              className="flex items-center justify-between gap-3 border-b border-border py-4 hover:bg-subtle sm:px-2"
            >
              <span className="flex flex-col">
                <span className="font-display text-title font-[560]">{t(`learn.tabs.${id}`)}</span>
                <span className="text-sm text-muted">{t(`landing.learnMore.${id}`)}</span>
              </span>
              <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
