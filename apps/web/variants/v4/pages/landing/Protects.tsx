import { cn } from 'cn';
import { CheckIcon, HeartHandshakeIcon, KeyRoundIcon, LockIcon, MinusIcon, type LucideIcon } from 'lucide-react';
import { RiskNote } from '@/components/product/risk-note';
import { t, type MessageKey } from '@/i18n';
import { HashLink, Helper, Section, SubSection } from './Section.tsx';

const NEEDS_SECOND: readonly MessageKey[] = ['landing.protects.needsSecond.withdraw', 'landing.protects.needsSecond.owner', 'landing.protects.needsSecond.lock'];

const MAIN_ALONE: readonly MessageKey[] = [
  'landing.protects.mainAlone.deactivate',
  'landing.protects.mainAlone.redelegate',
  'landing.protects.mainAlone.split',
  'landing.protects.mainAlone.manager',
];

/** The classes written out in full: Tailwind only generates utilities it finds in the source. */
const TILE: Record<'success' | 'neutral', string> = {
  success: 'bg-mint text-mint-ink',
  neutral: 'bg-sky text-sky-ink',
};
const CARD: Record<'success' | 'neutral', string> = {
  success: 'border-success-border/60',
  neutral: 'border-border',
};

/** One half of the panel: what the lock guards (success) or what the main key can still do alone (neutral). */
function LockColumn({ icon: Icon, tone, title, keys }: { icon: LucideIcon; tone: keyof typeof TILE; title: string; keys: readonly MessageKey[] }) {
  return (
    <div className={cn('flex flex-col gap-4 rounded-xl border-2 bg-surface p-5 shadow-sm sm:p-7', CARD[tone])}>
      <h3 className="flex items-center gap-3 text-lg font-extrabold">
        <span aria-hidden="true" className={cn('flex size-12 shrink-0 items-center justify-center rounded-lg', TILE[tone])}>
          <Icon className="size-6" />
        </span>
        {title}
      </h3>
      <ul className="flex flex-col gap-2.5 text-sm sm:text-base">
        {keys.map((key) => (
          <li key={key} className="flex items-start gap-3">
            <span aria-hidden="true" className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full', TILE[tone])}>
              {tone === 'success' ? <CheckIcon className="size-3.5" strokeWidth={3} /> : <MinusIcon className="size-3.5" strokeWidth={3} />}
            </span>
            <span className="text-pretty">{t(key)}</span>
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
      <div className="grid gap-4 md:grid-cols-2">
        <LockColumn icon={LockIcon} tone="success" title={t('landing.protects.needsSecondTitle')} keys={NEEDS_SECOND} />
        <LockColumn icon={KeyRoundIcon} tone="neutral" title={t('landing.protects.mainAloneTitle')} keys={MAIN_ALONE} />
      </div>
      <Helper icon={LockIcon} tone="mint" className="max-w-2xl">
        <p className="font-semibold">{t('landing.protects.thief')}</p>
      </Helper>
      <SubSection id="second-key" title={t('landing.secondKey.title')} className="mt-4 rounded-xl bg-peach/60 p-5 sm:p-7">
        <div className="grid items-start gap-4 md:grid-cols-2 md:gap-8">
          <RiskNote risk="second-key-can-freeze" variant="inline">
            <p>{t('landing.secondKey.freeze')}</p>
          </RiskNote>
          <div className="flex flex-col gap-3 text-sm">
            <ul className="flex flex-col gap-2">
              <li className="flex items-start gap-3 rounded-lg bg-surface p-3 text-pretty shadow-sm">
                <KeyRoundIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-peach-ink" />
                {t('landing.secondKey.differentSeed')}
              </li>
              <li className="flex items-start gap-3 rounded-lg bg-surface p-3 text-pretty shadow-sm">
                <HeartHandshakeIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-peach-ink" />
                {t('landing.secondKey.apart')}
              </li>
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
