import { MinusIcon } from 'lucide-react';
import { t, type Messages } from '@/i18n';
import { MAX_RESCUE_ACCOUNTS } from '@/pages/rescue/wizard';

type CannotDoItem = keyof Messages['landing']['cannotDo']['items'];

const ITEMS: readonly CannotDoItem[] = [
  'scope',
  'mainKeyActions',
  'split',
  'afterEnd',
  'lostKey',
  'freeze',
  'sameSeed',
  'newAccounts',
  'cliKeys',
  'alerts',
];

/**
 * "What Stakeward cannot do": linked from the footer of every page (UX rule 12), never folded. Each item finishes the
 * title's sentence. v7: two columns of plain lines under a heading at the left, the honest edge of the right future.
 */
export function CannotDo() {
  return (
    <section id="cannot-do" aria-labelledby="cannot-do-title" className="grid scroll-mt-4 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-12">
      <div className="flex flex-col gap-3">
        <p className="font-mono text-sm font-medium text-primary">The limits of the right-hand future</p>
        <h2 id="cannot-do-title" className="text-2xl text-balance sm:text-3xl">
          {t('landing.cannotDo.title')}
        </h2>
        <p className="text-base text-pretty text-muted">{t('landing.cannotDo.intro')}</p>
      </div>
      <ul className="grid gap-x-8 gap-y-3 text-base sm:grid-cols-2">
        {ITEMS.map((item) => (
          <li key={item} className="flex items-start gap-2 border-t border-border pt-3">
            <MinusIcon aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted" />
            <span className="text-pretty">{t(`landing.cannotDo.items.${item}`, { max: MAX_RESCUE_ACCOUNTS })}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
