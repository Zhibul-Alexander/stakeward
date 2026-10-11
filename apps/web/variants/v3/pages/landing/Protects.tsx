import { KeyRoundIcon, LockIcon, type LucideIcon } from 'lucide-react';
import { RiskNote } from '@/components/product/risk-note';
import { t, type MessageKey } from '@/i18n';
import { HashLink, Section, SubSection } from './Section.tsx';

const NEEDS_SECOND: readonly MessageKey[] = ['landing.protects.needsSecond.withdraw', 'landing.protects.needsSecond.owner', 'landing.protects.needsSecond.lock'];

const MAIN_ALONE: readonly MessageKey[] = [
  'landing.protects.mainAlone.deactivate',
  'landing.protects.mainAlone.redelegate',
  'landing.protects.mainAlone.split',
  'landing.protects.mainAlone.manager',
];

/** One column of the two-column table: what the lock guards, or what the main key can still do alone. */
function LockColumn({ icon: Icon, guarded, title, keys }: { icon: LucideIcon; guarded: boolean; title: string; keys: readonly MessageKey[] }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 border-b border-rule pb-2 text-base font-semibold">
        <Icon aria-hidden="true" className={guarded ? 'size-4 text-success' : 'size-4 text-muted'} />
        {title}
      </h3>
      <ul className="flex flex-col">
        {keys.map((key) => (
          <li
            key={key}
            className={
              guarded
                ? 'border-b border-border py-2.5 font-display text-[1.5rem] leading-[1.15]'
                : 'border-b border-border py-2.5 text-base text-muted'
            }
          >
            {t(key)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Variant v3: what the lock stops, set as a two-column table under chapter 2 (the guarded actions in the display serif,
 * what the main key can still do in plain text), and the sentence about the thief as the closing line.
 */
export function Protects() {
  return (
    <Section id="protects" title={t('landing.protects.title')} className="border-t border-border lg:ml-[13.5rem]">
      <div className="grid gap-8 md:grid-cols-2 md:gap-12">
        <LockColumn icon={LockIcon} guarded title={t('landing.protects.needsSecondTitle')} keys={NEEDS_SECOND} />
        <LockColumn icon={KeyRoundIcon} guarded={false} title={t('landing.protects.mainAloneTitle')} keys={MAIN_ALONE} />
      </div>
      <p className="max-w-[40rem] text-lg font-medium text-pretty sm:text-lede">{t('landing.protects.thief')}</p>
    </Section>
  );
}

/** The honest limit of the second key (`#second-key`), said before anyone picks one. Shown under chapter 3. */
export function SecondKey() {
  return (
    <SubSection id="second-key" title={t('landing.secondKey.title')} className="border-t border-border pt-5">
      <div className="grid items-start gap-4 md:grid-cols-2 md:gap-10">
        <RiskNote risk="second-key-can-freeze" variant="inline">
          <p className="text-base">{t('landing.secondKey.freeze')}</p>
        </RiskNote>
        <div className="flex flex-col gap-3 text-base">
          <ul className="flex list-disc flex-col gap-1 pl-5 marker:text-accent">
            <li className="text-pretty">{t('landing.secondKey.differentSeed')}</li>
            <li className="text-pretty">{t('landing.secondKey.apart')}</li>
          </ul>
          <p>
            <HashLink href="/learn/faq#faq-good-second-key">{t('landing.secondKey.more')}</HashLink>
          </p>
        </div>
      </div>
    </SubSection>
  );
}
