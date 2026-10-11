import { MinusIcon } from 'lucide-react';
import { t, type Messages } from '@/i18n';
import { MAX_RESCUE_ACCOUNTS } from '@/pages/rescue/wizard';
import { Section } from './Section.tsx';

type CannotDoItem = keyof Messages['landing']['cannotDo']['items'];

const ITEMS: readonly CannotDoItem[] = ['scope', 'mainKeyActions', 'split', 'afterEnd', 'lostKey', 'freeze', 'sameSeed', 'newAccounts', 'cliKeys', 'alerts'];

/** v8: "What Stakeward cannot do" as the limits page of the checklist: never folded, linked from every footer. */
export function CannotDo() {
  return (
    <Section id="cannot-do" title={t('landing.cannotDo.title')} intro={t('landing.cannotDo.intro')}>
      <ul role="list" className="grid gap-x-8 rounded-lg border border-dashed border-border-strong p-4 text-sm sm:p-6 md:grid-cols-2">
        {ITEMS.map((item) => (
          <li key={item} className="flex items-start gap-3 border-b border-border py-2.5 last:border-b-0 md:[&:nth-last-child(2)]:border-b-0">
            <MinusIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted" />
            <span className="text-pretty">{t(`landing.cannotDo.items.${item}`, { max: MAX_RESCUE_ACCOUNTS })}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
