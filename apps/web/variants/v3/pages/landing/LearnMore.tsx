import { ArrowUpRightIcon } from 'lucide-react';
import { Link } from 'wouter';
import { t } from '@/i18n';
import { LEARN_TABS } from '../LearnPage.tsx';

/** Variant v3: further reading, a plain index of the /learn tabs with one line each. */
export function LearnMore() {
  return (
    <section aria-labelledby="learn-more-title" className="flex flex-col gap-3">
      <h2 id="learn-more-title" className="border-b border-rule pb-2 text-[2rem] leading-[1.05] text-balance">
        {t('landing.learnMore.title')}
      </h2>
      <ul role="list" className="flex flex-col">
        {LEARN_TABS.map((id) => (
          <li key={id} className="border-b border-border">
            <Link href={`/learn/${id}`} className="group flex items-start justify-between gap-3 rounded-sm py-3">
              <span className="flex flex-col gap-0.5">
                <span className="text-base font-semibold group-hover:underline group-hover:decoration-accent group-hover:underline-offset-4">
                  {t(`learn.tabs.${id}`)}
                </span>
                <span className="text-sm text-muted">{t(`landing.learnMore.${id}`)}</span>
              </span>
              <ArrowUpRightIcon aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted group-hover:text-accent-ink" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
