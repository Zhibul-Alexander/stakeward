import { ArrowUpRightIcon } from 'lucide-react';
import { Link } from 'wouter';
import { t } from '@/i18n';
import { LEARN_TABS } from '../LearnPage.tsx';

/** The way to the details (/learn): an index of ruled rows, one per tab. */
export function LearnMore() {
  return (
    <section aria-labelledby="learn-more-title" className="grid gap-4 border-t-[6px] border-foreground pt-4 md:grid-cols-12 md:gap-x-6 md:pt-5">
      <h2 id="learn-more-title" className="text-2xl text-balance uppercase sm:text-3xl md:col-span-4 md:text-2xl lg:text-[2.5rem] lg:leading-[1]">
        {t('landing.learnMore.title')}
      </h2>
      <ul role="list" className="grid border-t-2 border-foreground md:col-span-8 sm:grid-cols-2 sm:gap-x-6">
        {LEARN_TABS.map((id) => (
          <li key={id} className="border-b border-foreground">
            <Link href={`/learn/${id}`} className="group flex items-center justify-between gap-3 py-3 hover:bg-foreground hover:text-background sm:px-2">
              <span className="flex flex-col">
                <span className="text-base font-bold uppercase tracking-wide">{t(`learn.tabs.${id}`)}</span>
                <span className="text-sm text-muted group-hover:text-background">{t(`landing.learnMore.${id}`)}</span>
              </span>
              <ArrowUpRightIcon aria-hidden="true" className="size-5 shrink-0" strokeWidth={2.5} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
