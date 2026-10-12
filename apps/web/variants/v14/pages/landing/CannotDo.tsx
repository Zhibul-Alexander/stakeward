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
 * "What Stakeward cannot do": linked from the footer of every page (UX rule 12), never folded. A plain two-column list
 * with hairlines, read like the record above it.
 */
export function CannotDo() {
  return (
    <Section id="cannot-do" title={t('landing.cannotDo.title')} intro={t('landing.cannotDo.intro')}>
      <ul className="grid gap-x-10 md:grid-cols-2">
        {ITEMS.map((item) => (
          <li key={item} className="flex items-start gap-2.5 border-t border-border py-3 text-sm sm:text-base">
            <XIcon aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted" />
            <span className="text-pretty">{t(`landing.cannotDo.items.${item}`, { max: MAX_RESCUE_ACCOUNTS })}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
