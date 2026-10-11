import { BanIcon, CheckIcon, KeyRoundIcon } from 'lucide-react';
import { t } from '@/i18n';
import { HashLink, Section } from './Section.tsx';

/**
 * v10: the diagram above already shows what the lock stops. This sheet is the second key's own spec, said before
 * anyone picks one (`#second-key`): what it can do alone (freeze), what it cannot (take), and how to choose it.
 */
export function Protects() {
  return (
    <Section id="second-key" title={t('landing.secondKey.title')} intro={t('landing.protects.thief')}>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-10">
        <div className="flex flex-col overflow-hidden rounded-lg border-2 border-accent bg-surface">
          <div className="flex items-center gap-3 border-b border-accent bg-accent-soft px-4 py-3">
            <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-md bg-accent text-on-accent">
              <KeyRoundIcon className="size-5" />
            </span>
            <p className="font-display text-lg font-semibold">{t('common.roles.second')}, alone</p>
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-3 px-4 py-4 text-sm">
            <dt className="flex items-center gap-1.5 font-semibold">
              <CheckIcon aria-hidden="true" className="size-4 text-accent-ink" />
              Can
            </dt>
            <dd className="text-pretty">Freeze the stake: move the lock date, even years ahead.</dd>
            <dt className="flex items-center gap-1.5 font-semibold text-danger">
              <BanIcon aria-hidden="true" className="size-4" />
              Cannot
            </dt>
            <dd className="text-pretty">Withdraw your SOL, or hand the stake to another wallet.</dd>
          </dl>
          <p className="mt-auto border-t border-border px-4 py-3 text-sm font-medium text-pretty">Keep it as safe as your main key.</p>
        </div>
        <div className="flex flex-col gap-4">
          <ol className="flex flex-col gap-3">
            {(['differentSeed', 'apart'] as const).map((key, index) => (
              <li key={key} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-7 shrink-0 items-center justify-center rounded-md border border-primary font-display text-sm font-semibold text-primary"
                >
                  {index + 1}
                </span>
                <span className="pt-0.5 text-base text-pretty">{t(`landing.secondKey.${key}`)}</span>
              </li>
            ))}
          </ol>
          <p className="text-sm text-muted">
            <HashLink href="/learn/faq#faq-good-second-key">{t('landing.secondKey.more')}</HashLink>
          </p>
        </div>
      </div>
    </Section>
  );
}
