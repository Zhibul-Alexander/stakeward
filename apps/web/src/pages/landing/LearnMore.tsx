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
      <h2 id="learn-more-title" className="text-lg font-semibold text-balance sm:text-2xl">
        {t('landing.learnMore.title')}
      </h2>
      <ul role="list" className="grid gap-2 sm:grid-cols-2">
        {LEARN_TABS.map((id) => (
          <li key={id}>
            <Link
              href={`/learn/${id}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 hover:bg-subtle"
            >
              <span className="flex flex-col">
                <span className="text-sm font-semibold">{t(`learn.tabs.${id}`)}</span>
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
