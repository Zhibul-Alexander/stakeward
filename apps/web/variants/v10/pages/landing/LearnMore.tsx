import { ChevronRightIcon } from 'lucide-react';
import { Link } from 'wouter';
import { t } from '@/i18n';
import { LEARN_TABS } from '../LearnPage.tsx';

/** v10: the way to the details (/learn), as the index of a drawing set: one ruled line per sheet. */
export function LearnMore() {
  return (
    <section aria-labelledby="learn-more-title" className="flex flex-col gap-4 border-t-2 border-primary pt-5">
      <h2 id="learn-more-title" className="font-display text-2xl text-balance">
        {t('landing.learnMore.title')}
      </h2>
      <ul role="list" className="grid border-t border-line sm:grid-cols-2 sm:gap-x-8">
        {LEARN_TABS.map((id) => (
          <li key={id} className="border-b border-line">
            <Link href={`/learn/${id}`} className="group flex items-center justify-between gap-3 px-1 py-3 hover:bg-subtle">
              <span className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-3">
                <span className="font-display text-base font-semibold text-primary group-hover:underline">{t(`learn.tabs.${id}`)}</span>
                <span className="text-sm text-muted">{t(`landing.learnMore.${id}`)}</span>
              </span>
              <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-primary" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
