import { ExternalLinkIcon, KeyRoundIcon, LockIcon, TriangleAlertIcon } from 'lucide-react';
import { GATE_RESULTS_URL } from '@/config';
import { t, type MessageKey } from '@/i18n';

const NEEDS_SECOND: readonly MessageKey[] = ['landing.protects.needsSecond.withdraw', 'landing.protects.needsSecond.owner', 'landing.protects.needsSecond.lock'];
const MAIN_ALONE: readonly MessageKey[] = [
  'landing.protects.mainAlone.deactivate',
  'landing.protects.mainAlone.redelegate',
  'landing.protects.mainAlone.split',
  'landing.protects.mainAlone.manager',
];

/** docs/gate.md, mainnet check 3: Withdraw signed by the main key alone failed with LockupInForce. */
const MAINNET_REFUSAL_TX =
  'https://explorer.solana.com/tx/AntzPaGpqwGtJ2cuBDwkUyG8Rqi4UwusuRJbrQA3v7qWwmS66hez8SMHuC5Zy1EE9tq64H54EVVsp3bthETjLVw';

const LINK = 'rounded-sm font-semibold text-primary underline underline-offset-4 hover:decoration-2';

function External({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" aria-label={`${children} ${t('common.opensInNewTab')}`} className={LINK}>
      {children}
      <ExternalLinkIcon aria-hidden="true" className="ml-1 inline size-3.5 align-baseline" />
    </a>
  );
}

/**
 * v12: what the lock stops, as a two-column specification, the network evidence under it (docs/gate.md), and the
 * caution plate: the one place the accent colour appears, because the second key's limit must not be missed.
 */
export function LockSpec() {
  return (
    <section id="protects" aria-labelledby="protects-title" className="flex scroll-mt-4 flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 id="protects-title" className="text-2xl text-balance">
          {t('landing.protects.title')}
        </h2>
        <p className="max-w-prose text-base text-pretty text-muted">The Solana stake program enforces these rules, not Stakeward.</p>
      </div>
      <div className="grid rounded-lg border border-border-strong bg-surface md:grid-cols-2">
        <div className="flex flex-col gap-2 p-4 sm:p-5">
          <h3 className="flex items-center gap-2 text-base font-bold">
            <LockIcon aria-hidden="true" className="size-4 text-success" />
            {t('landing.protects.needsSecondTitle')}
          </h3>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-base marker:text-muted">
            {NEEDS_SECOND.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-2 border-t border-border p-4 sm:p-5 md:border-t-0 md:border-l">
          <h3 className="flex items-center gap-2 text-base font-bold">
            <KeyRoundIcon aria-hidden="true" className="size-4 text-muted" />
            {t('landing.protects.mainAloneTitle')}
          </h3>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-base marker:text-muted">
            {MAIN_ALONE.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="flex max-w-prose flex-col gap-1 text-sm text-pretty">
        <p className="text-base font-bold">{t('landing.protects.thief')}</p>
        <p className="text-muted">
          Checked on Solana mainnet on 5 October 2026: a withdraw signed by the main key alone failed with LockupInForce.{' '}
          <External href={MAINNET_REFUSAL_TX}>See the transaction</External>
        </p>
        <p className="text-muted">
          8 of 8 lock checks matched on mainnet and 28 of 28 on devnet. <External href={GATE_RESULTS_URL}>Read the results</External>
        </p>
      </div>

      <section
        id="second-key"
        aria-labelledby="second-key-title"
        data-slot="caution-plate"
        className="flex scroll-mt-4 flex-col gap-3 rounded-lg border-2 border-on-caution bg-caution p-4 text-on-caution sm:flex-row sm:gap-5 sm:p-5"
      >
        <TriangleAlertIcon aria-hidden="true" className="size-6 shrink-0" />
        <div className="flex flex-col gap-2">
          <h3 id="second-key-title" className="text-lg font-bold">
            Caution: the second key can freeze your stake
          </h3>
          <p className="max-w-prose text-base text-pretty">
            {t('components.risk.secondKeyCanFreeze')} {t('landing.secondKey.freeze')}
          </p>
          <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm">
            <li>{t('landing.secondKey.differentSeed')}</li>
            <li>{t('landing.secondKey.apart')}</li>
          </ul>
          <p className="text-sm">
            <a href="/learn/faq#faq-good-second-key" className="rounded-sm font-bold underline underline-offset-4 focus-visible:outline-on-caution">
              {t('landing.secondKey.more')}
            </a>
          </p>
        </div>
      </section>
    </section>
  );
}
