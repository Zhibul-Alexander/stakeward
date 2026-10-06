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
  'lostMain',
  'lostSecond',
  'freeze',
  'sameSeed',
  'newAccounts',
  'cliKeys',
  'noPower',
  'alerts',
  'noKeys',
];

/** "What Stakeward cannot do": linked from the footer of every page (UX rule 12), read before protecting. */
export function CannotDo() {
  return (
    <Section id="cannot-do" title={t('landing.cannotDo.title')}>
      <p className="max-w-prose">{t('landing.cannotDo.intro')}</p>
      <ul className="grid gap-x-8 gap-y-3 md:grid-cols-2">
        {ITEMS.map((item) => (
          <li key={item} className="flex items-start gap-2">
            <XIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
            <span>{t(`landing.cannotDo.items.${item}`, { max: MAX_RESCUE_ACCOUNTS })}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
