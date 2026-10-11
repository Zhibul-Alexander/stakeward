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

/** The classes written out in full: Tailwind only generates utilities it finds in the source. */
const TILE: Record<'success' | 'neutral', string> = {
  success: 'text-success',
  neutral: 'text-neutral',
};

/** The bracketed tag of each column: what the stake program answers to that key alone. */
const TAG: Record<'success' | 'neutral', string> = {
  success: 'term-tag border border-success-border bg-success-soft px-1.5 text-xs text-success',
  neutral: 'term-tag border border-neutral-border px-1.5 text-xs text-neutral',
};

/** One half of the panel: what the lock guards (success) or what the main key can still do alone (neutral). */
function LockColumn({ icon: Icon, tone, title, keys }: { icon: LucideIcon; tone: keyof typeof TILE; title: string; keys: readonly MessageKey[] }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <Icon aria-hidden="true" className={cn('size-4 shrink-0', TILE[tone])} />
          {title}
        </h3>
        <span aria-hidden="true" className={TAG[tone]}>
          {tone === 'success' ? 'blocked' : 'allowed'}
        </span>
      </div>
      <ul className="flex flex-col gap-1.5 text-sm">
        {keys.map((key) => (
          <li key={key} className="flex gap-2">
            <span aria-hidden="true" className={TILE[tone]}>
              {tone === 'success' ? '-' : '+'}
            </span>
            <span>{t(key)}</span>
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
      <div className="grid divide-y divide-border border border-border-strong bg-surface md:grid-cols-2 md:divide-x md:divide-y-0">
        <LockColumn icon={LockIcon} tone="success" title={t('landing.protects.needsSecondTitle')} keys={NEEDS_SECOND} />
        <LockColumn icon={KeyRoundIcon} tone="neutral" title={t('landing.protects.mainAloneTitle')} keys={MAIN_ALONE} />
      </div>
      <p className="max-w-prose text-sm font-medium text-pretty sm:text-base">
        <span aria-hidden="true" className="text-primary phosphor">&gt; </span>
        {t('landing.protects.thief')}
      </p>
      <SubSection id="second-key" title={t('landing.secondKey.title')} className="sm:mt-2">
        <div className="grid items-start gap-3 md:grid-cols-2 md:gap-8">
          <RiskNote risk="second-key-can-freeze" variant="inline">
            <p>{t('landing.secondKey.freeze')}</p>
          </RiskNote>
          <div className="flex flex-col gap-2 text-sm">
            <ul className="flex list-[square] flex-col gap-1 pl-5 marker:text-primary">
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
