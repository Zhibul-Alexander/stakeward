import { XIcon } from 'lucide-react';
import { t, type Messages } from '@/i18n';
import { MAX_RESCUE_ACCOUNTS } from '@/pages/rescue/wizard';
import { Section } from './Section.tsx';

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
 * "What Stakeward cannot do": linked from the footer of every page (UX rule 12), read before protecting, so it is
 * never folded, on its soft panel at every width. Each item finishes the title's sentence.
 */
export function CannotDo() {
  return (
    <Section id="cannot-do" title={t('landing.cannotDo.title')} intro={t('landing.cannotDo.intro')}>
      <ul className="grid gap-x-8 gap-y-1 rounded-lg bg-subtle p-3 text-sm sm:gap-y-2.5 sm:p-6 md:grid-cols-2">
        {ITEMS.map((item) => (
          <li key={item} className="flex items-start gap-2">
            <XIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted" />
            <span className="text-pretty">{t(`landing.cannotDo.items.${item}`, { max: MAX_RESCUE_ACCOUNTS })}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
