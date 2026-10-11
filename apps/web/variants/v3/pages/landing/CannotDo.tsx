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
 * Variant v3, chapter 4: "What Stakeward cannot do", never folded (UX rule 12). Set as a printed list in two columns:
 * each item finishes the title's sentence, with a struck-through rule mark in the margin.
 */
export function CannotDo() {
  return (
    <Section id="cannot-do" chapter={4} title={t('landing.cannotDo.title')} intro={t('landing.cannotDo.intro')}>
      <ul className="grid gap-x-12 md:grid-cols-2">
        {ITEMS.map((item) => (
          <li key={item} className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-baseline gap-2 border-t border-border py-3 text-base">
            <span aria-hidden="true" className="font-display text-[1.375rem] leading-none text-accent">
              ×
            </span>
            <span className="text-pretty">{t(`landing.cannotDo.items.${item}`, { max: MAX_RESCUE_ACCOUNTS })}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
