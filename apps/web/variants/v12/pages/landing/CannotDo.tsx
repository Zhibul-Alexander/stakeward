import { XIcon } from 'lucide-react';
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
 * v12 "What Stakeward cannot do" (`#cannot-do`, linked from every footer): the manual's limits page, never folded.
 * Each item finishes the title's sentence.
 */
export function CannotDo() {
  return (
    <section id="cannot-do" aria-labelledby="cannot-do-title" className="flex scroll-mt-4 flex-col gap-4 border-t-2 border-foreground pt-4">
      <div className="flex max-w-prose flex-col gap-1">
        <h2 id="cannot-do-title" className="text-2xl text-balance">
          {t('landing.cannotDo.title')}
        </h2>
        <p className="text-base text-pretty text-muted">{t('landing.cannotDo.intro')}</p>
      </div>
      <ul className="grid gap-x-10 gap-y-3 text-base md:grid-cols-2">
        {ITEMS.map((item) => (
          <li key={item} className="flex items-start gap-2 border-b border-border pb-3">
            <XIcon aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted" />
            <span className="text-pretty">{t(`landing.cannotDo.items.${item}`, { max: MAX_RESCUE_ACCOUNTS })}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
