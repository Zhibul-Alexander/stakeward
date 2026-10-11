import { cn } from 'cn';
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

/** One half: what the lock guards (signal fill) or what the main key can still do alone (plain paper). */
function LockColumn({ icon: Icon, signal, title, keys }: { icon: LucideIcon; signal: boolean; title: string; keys: readonly MessageKey[] }) {
  return (
    <div className={cn('flex flex-col gap-3 border-[3px] border-foreground p-4 sm:p-5', signal ? 'bg-signal text-on-signal' : 'bg-background')}>
      <h3 className="flex items-center gap-3 font-display text-xl leading-none uppercase">
        <Icon aria-hidden="true" className="size-6 shrink-0" strokeWidth={2.5} />
        {title}
      </h3>
      <ul className={cn('flex flex-col border-t-2', signal ? 'border-on-signal' : 'border-foreground')}>
        {keys.map((key) => (
          <li key={key} className={cn('border-b py-2 text-base font-medium', signal ? 'border-on-signal' : 'border-foreground')}>
            {t(key)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What the lock stops while it holds, and what it does not (CLAUDE.md sections 1 and 4), then the honest limit of the
 * second key, said before anyone picks one (`#second-key`): the risk note's inline form (its icon and words, no fill),
 * since nothing here is about to be signed.
 */
export function Protects() {
  return (
    <Section id="protects" title={t('landing.protects.title')}>
      <div className="grid gap-3 md:grid-cols-2 md:gap-0 md:[&>*+*]:border-l-0">
        <LockColumn icon={LockIcon} signal title={t('landing.protects.needsSecondTitle')} keys={NEEDS_SECOND} />
        <LockColumn icon={KeyRoundIcon} signal={false} title={t('landing.protects.mainAloneTitle')} keys={MAIN_ALONE} />
      </div>
      <p className="max-w-prose font-display text-xl leading-tight text-pretty uppercase sm:text-2xl">{t('landing.protects.thief')}</p>
      <SubSection id="second-key" title={t('landing.secondKey.title')} className="sm:mt-2">
        <div className="grid items-start gap-3 md:grid-cols-2 md:gap-8">
          <RiskNote risk="second-key-can-freeze" variant="inline">
            <p>{t('landing.secondKey.freeze')}</p>
          </RiskNote>
          <div className="flex flex-col gap-2 text-sm">
            <ul className="flex list-disc flex-col gap-1 pl-5 marker:text-foreground">
              <li className="text-pretty">{t('landing.secondKey.differentSeed')}</li>
              <li className="text-pretty">{t('landing.secondKey.apart')}</li>
            </ul>
            <p>
              <HashLink href="/learn/faq#faq-good-second-key">{t('landing.secondKey.more')}</HashLink>
            </p>
          </div>
        </div>
      </SubSection>
    </Section>
  );
}
