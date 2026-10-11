import { ShieldCheckIcon, TriangleAlertIcon } from 'lucide-react';
import { t, type MessageKey } from '@/i18n';
import { HashLink, Section } from './Section.tsx';

const NEEDS_SECOND: readonly MessageKey[] = ['landing.protects.needsSecond.withdraw', 'landing.protects.needsSecond.owner', 'landing.protects.needsSecond.lock'];

const MAIN_ALONE: readonly MessageKey[] = [
  'landing.protects.mainAlone.deactivate',
  'landing.protects.mainAlone.redelegate',
  'landing.protects.mainAlone.split',
  'landing.protects.mainAlone.manager',
];

/**
 * v8: what the lock holds and what it does not, as two checklist columns with a response for each line (Blocked /
 * Open), then the caution about the second key as an amber caution card, said before anyone picks one.
 */
export function Protects() {
  return (
    <Section id="protects" title={t('landing.protects.title')} intro={t('landing.protects.thief')}>
      <div className="grid overflow-hidden rounded-lg border border-border bg-surface md:grid-cols-2 md:divide-x md:divide-border">
        <Column title={t('landing.protects.needsSecondTitle')} keys={NEEDS_SECOND} response="Blocked" done />
        <Column title={t('landing.protects.mainAloneTitle')} keys={MAIN_ALONE} response="Open" done={false} />
      </div>
      <section
        id="second-key"
        aria-labelledby="second-key-title"
        className="mt-2 scroll-mt-4 overflow-hidden rounded-lg border-2 border-warning-border bg-surface"
      >
        <div className="flex items-center gap-2 bg-warning-soft px-4 py-2.5 text-warning sm:px-6">
          <TriangleAlertIcon aria-hidden="true" className="size-5 shrink-0" />
          <h3 id="second-key-title" className="text-base font-semibold">
            {t('landing.secondKey.title')}
          </h3>
        </div>
        <div className="grid gap-4 px-4 py-4 sm:px-6 sm:py-5 md:grid-cols-2 md:gap-8">
          <div className="flex flex-col gap-2">
            <p className="font-medium text-pretty">{t('components.risk.secondKeyCanFreeze')}</p>
            <p className="text-sm text-pretty text-muted">{t('landing.secondKey.freeze')}</p>
          </div>
          <div className="flex flex-col gap-3">
            <ul role="list" className="flex flex-col gap-2 text-sm">
              {(['landing.secondKey.differentSeed', 'landing.secondKey.apart'] as const).map((key) => (
                <li key={key} className="flex items-start gap-3">
                  <span aria-hidden="true" className="mt-0.5 size-4 shrink-0 rounded-sm border-2 border-todo" />
                  <span className="text-pretty">{t(key)}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm">
              <HashLink href="/learn/faq#faq-good-second-key">{t('landing.secondKey.more')}</HashLink>
            </p>
          </div>
        </div>
      </section>
    </Section>
  );
}

function Column({ title, keys, response, done }: { title: string; keys: readonly MessageKey[]; response: string; done: boolean }) {
  return (
    <div className="flex flex-col border-b border-border last:border-b-0 md:border-b-0">
      <h3 className="flex items-center gap-2 border-b border-border bg-subtle px-4 py-3 text-base font-semibold sm:px-6">
        {done ? (
          <ShieldCheckIcon aria-hidden="true" className="size-5 shrink-0 text-success" />
        ) : (
          <TriangleAlertIcon aria-hidden="true" className="size-5 shrink-0 text-warning" />
        )}
        {title}
      </h3>
      <ul role="list" className="flex flex-col px-4 py-2 sm:px-6">
        {keys.map((key) => (
          <li key={key} className="flex items-end gap-2 py-2 text-sm">
            <span className="text-pretty">{t(key)}</span>
            <span aria-hidden="true" className="leader" />
            <span className={done ? 'shrink-0 font-mono text-xs font-medium text-success' : 'shrink-0 font-mono text-xs font-medium text-warning'}>
              {response}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
