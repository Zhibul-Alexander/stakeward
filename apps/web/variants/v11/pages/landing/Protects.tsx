import { KeyRoundIcon, LockIcon } from 'lucide-react';
import { RiskNote } from '@/components/product/risk-note';
import { CLUSTER } from '@/config';
import { t, type MessageKey } from '@/i18n';
import { HashLink, Section, SubSection } from './Section.tsx';

const NEEDS_SECOND: readonly MessageKey[] = ['landing.protects.needsSecond.withdraw', 'landing.protects.needsSecond.owner', 'landing.protects.needsSecond.lock'];

const MAIN_ALONE: readonly MessageKey[] = [
  'landing.protects.mainAlone.deactivate',
  'landing.protects.mainAlone.redelegate',
  'landing.protects.mainAlone.split',
  'landing.protects.mainAlone.manager',
];

/**
 * v11: what the lock stops, as the stake program's own rule table: each action of a locked account and who must sign
 * it. Then the line a thief cares about, set large, and the second key's honest limit with its own heading.
 */
export function Protects() {
  const needs = t('landing.protects.needsSecondTitle');
  const alone = t('landing.protects.mainAloneTitle');
  return (
    <Section id="protects" title={t('landing.protects.title')} intro={t('landing.how.intro')}>
      <div className="grid gap-8 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:gap-12">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">{t('landing.protects.title')}</caption>
          <thead>
            <tr className="border-b border-foreground/70">
              <th scope="col" className="py-2 pr-4 font-semibold">
                While the lock holds
              </th>
              <th scope="col" className="py-2 font-semibold">
                Who signs
              </th>
            </tr>
          </thead>
          <tbody>
            {NEEDS_SECOND.map((key) => (
              <tr key={key} className="border-b border-border">
                <th scope="row" className="py-2.5 pr-4 font-normal">
                  {t(key)}
                </th>
                <td className="py-2.5">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                    <LockIcon aria-hidden="true" className="size-4 shrink-0 text-success" />
                    {needs}
                  </span>
                </td>
              </tr>
            ))}
            {MAIN_ALONE.map((key) => (
              <tr key={key} className="border-b border-border">
                <th scope="row" className="py-2.5 pr-4 font-normal">
                  {t(key)}
                </th>
                <td className="py-2.5 text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <KeyRoundIcon aria-hidden="true" className="size-4 shrink-0" />
                    {t('common.roles.main')} alone
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-col gap-4 md:pt-2">
          <p className="font-serif text-2xl leading-snug font-medium text-pretty sm:text-3xl sm:leading-tight">{t('landing.protects.thief')}</p>
          <p className="text-base text-pretty text-muted">
            {alone} stop staking, move or split the stake. Telegram tells you when that happens, and Rescue moves the
            stake to a new wallet: your main key, second key and new wallet sign together.
          </p>
          <p className="text-sm text-pretty text-muted">
            {t('landing.how.period')}
            {CLUSTER === 'devnet' ? <span> {t('landing.how.periodDevnet')}</span> : null}
          </p>
        </div>
      </div>
      <SubSection id="second-key" title={t('landing.secondKey.title')} className="rounded-record border border-warning-border bg-surface p-4 sm:p-6">
        <div className="grid items-start gap-4 md:grid-cols-2 md:gap-10">
          <RiskNote risk="second-key-can-freeze" variant="inline" className="text-base">
            <p className="font-normal">{t('landing.secondKey.freeze')}</p>
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
