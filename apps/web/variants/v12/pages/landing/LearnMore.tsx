import { Link } from 'wouter';
import { t } from '@/i18n';
import { LEARN_TABS } from '../LearnPage.tsx';

/** v12: the appendix: one line per /learn tab, like a manual's list of annexes. */
export function LearnMore() {
  return (
    <section aria-labelledby="learn-more-title" className="flex flex-col gap-3 border-t border-border-strong pt-4">
      <h2 id="learn-more-title" className="text-lg font-bold">
        {t('landing.learnMore.title')}
      </h2>
      <ul role="list" className="grid gap-x-10 sm:grid-cols-2">
        {LEARN_TABS.map((id) => (
          <li key={id} className="border-b border-border">
            <Link href={`/learn/${id}`} className="group flex min-h-11 flex-wrap items-baseline gap-x-3 py-2">
              <span className="font-bold underline underline-offset-4 group-hover:decoration-2">{t(`learn.tabs.${id}`)}</span>
              <span className="text-sm text-muted">{t(`landing.learnMore.${id}`)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
