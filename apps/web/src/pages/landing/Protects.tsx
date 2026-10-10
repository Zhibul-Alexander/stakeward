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
  success: 'bg-success-soft text-success',
  neutral: 'bg-neutral-soft text-neutral',
};

/** One half of the panel: what the lock guards (success) or what the main key can still do alone (neutral). */
function LockColumn({ icon: Icon, tone, title, keys }: { icon: LucideIcon; tone: keyof typeof TILE; title: string; keys: readonly MessageKey[] }) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:gap-3 sm:p-5">
      <h3 className="flex items-center gap-3 text-base font-semibold">
        <span aria-hidden="true" className={cn('flex size-6 shrink-0 items-center justify-center rounded-md sm:size-8', TILE[tone])}>
          <Icon className="size-4" />
        </span>
        {title}
      </h3>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm marker:text-muted">
        {keys.map((key) => (
          <li key={key}>{t(key)}</li>
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
      <div className="grid divide-y divide-border rounded-lg border border-border bg-surface md:grid-cols-2 md:divide-x md:divide-y-0">
        <LockColumn icon={LockIcon} tone="success" title={t('landing.protects.needsSecondTitle')} keys={NEEDS_SECOND} />
        <LockColumn icon={KeyRoundIcon} tone="neutral" title={t('landing.protects.mainAloneTitle')} keys={MAIN_ALONE} />
      </div>
      <p className="max-w-prose text-sm font-medium text-pretty sm:text-base">{t('landing.protects.thief')}</p>
      <SubSection id="second-key" title={t('landing.secondKey.title')} className="sm:mt-2">
        <div className="grid items-start gap-3 md:grid-cols-2 md:gap-8">
          <RiskNote risk="second-key-can-freeze" variant="inline">
            <p>{t('landing.secondKey.freeze')}</p>
          </RiskNote>
          <div className="flex flex-col gap-2 text-sm">
            <ul className="flex list-disc flex-col gap-1 pl-5 marker:text-muted">
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
