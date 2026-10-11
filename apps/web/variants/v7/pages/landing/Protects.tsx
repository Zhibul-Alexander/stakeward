import { CheckIcon, ShieldCheckIcon, ShieldOffIcon, XIcon } from 'lucide-react';
import { RiskNote } from '@/components/product/risk-note';
import { t, type MessageKey } from '@/i18n';
import { HashLink } from './Section.tsx';

type Row = { key: MessageKey; locked: boolean };

/** What a thief with only the main key can do, without the lock and with it (CLAUDE.md section 4). */
const ROWS: readonly Row[] = [
  { key: 'landing.protects.needsSecond.withdraw', locked: true },
  { key: 'landing.protects.needsSecond.owner', locked: true },
  { key: 'landing.protects.needsSecond.lock', locked: true },
  { key: 'landing.protects.mainAlone.deactivate', locked: false },
  { key: 'landing.protects.mainAlone.redelegate', locked: false },
  { key: 'landing.protects.mainAlone.split', locked: false },
  { key: 'landing.protects.mainAlone.manager', locked: false },
];

function ThiefCan() {
  return (
    <span className="inline-flex items-center gap-1.5 font-medium">
      <CheckIcon aria-hidden="true" className="size-4 shrink-0 text-danger" />
      Thief can
    </span>
  );
}

/**
 * What the lock stops and where both futures look the same: one table, the thief's moves down the side, the two
 * futures across. Then the honest limit of the second key (`#second-key`), said before anyone picks one.
 */
export function Protects() {
  return (
    <section id="protects" aria-labelledby="protects-title" className="flex scroll-mt-4 flex-col gap-8">
      <div className="flex max-w-2xl flex-col gap-3">
        <p className="font-mono text-sm font-medium text-primary tabular-nums">09:15, move by move</p>
        <h2 id="protects-title" className="text-2xl text-balance sm:text-3xl">
          {t('landing.protects.title')}, and what it does not
        </h2>
        <p className="text-base text-pretty text-muted sm:text-lg">
          The thief holds your main key in both futures. The lock changes the three moves that take your SOL away.
        </p>
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full table-fixed border-collapse text-left text-sm sm:text-base">
          <caption className="sr-only">What a thief with your main key can do, without the lock and with Stakeward</caption>
          <colgroup>
            <col className="w-[40%] sm:w-1/2" />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="bg-surface px-3 py-3 text-sm font-medium text-muted sm:px-5">
                With only your main key
              </th>
              <th scope="col" className="scope-night px-3 py-3 text-sm font-medium sm:px-5">
                <span className="inline-flex items-center gap-1.5">
                  <ShieldOffIcon aria-hidden="true" className="size-4 shrink-0 text-muted" />
                  Without the lock
                </span>
              </th>
              <th scope="col" className="scope-day px-3 py-3 text-sm font-medium sm:px-5">
                <span className="inline-flex items-center gap-1.5 text-primary">
                  <ShieldCheckIcon aria-hidden="true" className="size-4 shrink-0" />
                  With Stakeward
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.key} className="border-t border-border">
                <th scope="row" className="bg-surface px-3 py-3 font-normal text-pretty sm:px-5">
                  {t(row.key)}
                </th>
                <td className="scope-night border-t border-border px-3 py-3 sm:px-5">
                  <ThiefCan />
                </td>
                <td className="scope-day border-t border-border px-3 py-3 sm:px-5">
                  {row.locked ? (
                    <span className="inline-flex items-center gap-1.5 font-semibold text-primary">
                      <XIcon aria-hidden="true" className="size-4 shrink-0" />
                      Needs your second key
                    </span>
                  ) : (
                    <ThiefCan />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="max-w-prose text-base font-medium text-pretty sm:text-lg">{t('landing.protects.thief')}</p>

      <section id="second-key" aria-labelledby="second-key-title" className="grid scroll-mt-4 gap-6 rounded-xl bg-subtle p-5 sm:p-8 md:grid-cols-2 md:gap-10">
        <div className="flex flex-col gap-3">
          <h3 id="second-key-title" className="text-lg font-semibold text-balance">
            {t('landing.secondKey.title')}
          </h3>
          <RiskNote risk="second-key-can-freeze" variant="inline">
            <p>{t('landing.secondKey.freeze')}</p>
          </RiskNote>
        </div>
        <div className="flex flex-col gap-3 text-base">
          <ul className="flex list-disc flex-col gap-1.5 pl-5 marker:text-muted">
            <li className="text-pretty">{t('landing.secondKey.differentSeed')}</li>
            <li className="text-pretty">{t('landing.secondKey.apart')}</li>
          </ul>
          <p>
            <HashLink href="/learn/faq#faq-good-second-key">{t('landing.secondKey.more')}</HashLink>
          </p>
        </div>
      </section>
    </section>
  );
}
