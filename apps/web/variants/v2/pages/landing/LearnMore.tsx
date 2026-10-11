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
      <p aria-hidden="true" className="text-xs text-muted sm:text-sm">
        <span className="text-primary phosphor">$ </span>
        ls ./learn
      </p>
      <h2 id="learn-more-title" className="text-lg font-semibold text-balance sm:text-2xl">
        {t('landing.learnMore.title')}
      </h2>
      <ul role="list" className="grid divide-y divide-border border border-border-strong bg-surface">
        {LEARN_TABS.map((id) => (
          <li key={id}>
            <Link
              href={`/learn/${id}`}
              className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-subtle sm:grid-cols-[9rem_minmax(0,1fr)_auto]"
            >
              <span aria-hidden="true" className="hidden text-sm text-primary sm:block">
                ./learn/{id}
              </span>
              <span className="flex flex-col sm:flex-row sm:items-baseline sm:gap-4">
                <span className="text-sm font-semibold group-hover:text-primary sm:w-28 sm:shrink-0">{t(`learn.tabs.${id}`)}</span>
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
