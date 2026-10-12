import { BanIcon, CheckIcon, KeyRoundIcon } from 'lucide-react';
import { t } from '@/i18n';
import { HashLink, Section } from './Section.tsx';

/**
 * The honest limit of the second key, said before anyone picks one (`#second-key`, CLAUDE.md section 1): what it can
 * do alone (keep the stake locked), what it cannot (take it), and how to choose it. The figure above already shows
 * what the lock stops, so this is the second key's own spec sheet (D145), framed in its colour.
 */
export function Protects() {
  return (
    <Section id="second-key" title={t('landing.secondKey.title')} intro={t('landing.protects.thief')}>
      <div className="grid gap-6 md:grid-cols-2 md:gap-10">
        <div className="flex flex-col overflow-hidden rounded-lg border-2 border-accent bg-surface">
          <div className="flex items-center gap-3 border-b border-accent bg-accent-soft px-4 py-3">
            <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-on-accent">
              <KeyRoundIcon className="size-5" />
            </span>
            <h3 className="text-lg font-semibold">{t('landing.secondKey.alone')}</h3>
          </div>
          <dl className="grid grid-cols-icon gap-x-4 gap-y-3 px-4 py-4 text-sm">
            <dt className="flex items-center gap-1.5 font-semibold text-accent-ink">
              <CheckIcon aria-hidden="true" className="size-4" />
              {t('landing.diagram.result.yes')}
            </dt>
            <dd className="text-pretty">{t('landing.secondKey.can')}</dd>
            <dt className="flex items-center gap-1.5 font-semibold text-danger">
              <BanIcon aria-hidden="true" className="size-4" />
              {t('landing.diagram.result.no')}
            </dt>
            <dd className="text-pretty">{t('landing.secondKey.cannot')}</dd>
          </dl>
          <p className="mt-auto border-t border-border px-4 py-3 text-sm font-medium text-pretty">{t('landing.secondKey.keepSafe')}</p>
        </div>
        <div className="flex flex-col gap-4">
          <ul className="flex list-disc flex-col gap-2 pl-5 text-base marker:text-primary">
            <li className="text-pretty">{t('landing.secondKey.differentSeed')}</li>
            <li className="text-pretty">{t('landing.secondKey.apart')}</li>
          </ul>
          <p className="text-sm">
            <HashLink href="/learn/faq#faq-good-second-key">{t('landing.secondKey.more')}</HashLink>
          </p>
        </div>
      </div>
    </Section>
  );
}
