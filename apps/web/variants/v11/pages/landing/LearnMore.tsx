import { ChevronRightIcon } from 'lucide-react';
import { Link } from 'wouter';
import { t } from '@/i18n';
import { LEARN_TABS } from '../LearnPage.tsx';

/** v11: the way to the details as a plain index, one ruled line per /learn tab with what it answers. */
export function LearnMore() {
  return (
    <section aria-labelledby="learn-more-title" className="flex flex-col gap-4">
      <h2 id="learn-more-title" className="font-serif text-2xl font-medium text-balance sm:text-3xl">
        {t('landing.learnMore.title')}
      </h2>
      <ul role="list" className="grid border-t border-foreground/70 sm:grid-cols-2 sm:gap-x-10">
        {LEARN_TABS.map((id) => (
          <li key={id} className="border-b border-border">
            <Link href={`/learn/${id}`} className="group flex min-h-14 items-center justify-between gap-3 rounded-sm py-3">
              <span className="flex flex-col sm:flex-row sm:items-baseline sm:gap-3">
                <span className="text-base font-semibold group-hover:underline group-hover:underline-offset-4">{t(`learn.tabs.${id}`)}</span>
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
