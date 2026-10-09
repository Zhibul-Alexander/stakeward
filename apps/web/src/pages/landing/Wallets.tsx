import { CircleQuestionMarkIcon } from 'lucide-react';
import { SupportBadge } from '@/components/product/support-badge';
import { t } from '@/i18n';
import { HashLink, Section } from './Section.tsx';
import { matrixDateText, WALLET_MATRIX_DATE, WALLET_PAIRS, type PairSupport, type WalletSetup } from './wallet-support.ts';

const setupName = (setup: WalletSetup) => t(`landing.wallets.setups.${setup}`);

/**
 * One pair on one line: its name (main key's wallet first), then how signing went with both wallets in this browser
 * and by link. The verdicts wrap under the name on a phone.
 */
function PairRow({ pair }: { pair: PairSupport }) {
  return (
    <li data-pair={pair.id} className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        <h3 className="text-base font-semibold text-pretty">
          {t('landing.wallets.pairLabel', { main: setupName(pair.main), second: setupName(pair.second) })}
        </h3>
        <dl className="flex flex-wrap gap-x-4 gap-y-2 text-sm lg:shrink-0">
          <div className="flex items-center gap-2">
            <dt className="text-muted">{t('landing.wallets.here')}</dt>
            <dd>
              <SupportBadge verdict={pair.here} />
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-muted">{t('landing.wallets.link')}</dt>
            <dd>
              <SupportBadge verdict={pair.link} />
            </dd>
          </div>
        </dl>
      </div>
      {pair.note === null ? null : <p className="text-sm text-muted">{t(`landing.wallets.notes.${pair.note}`)}</p>}
    </li>
  );
}

type WalletsProps = {
  /** The wallet matrix's results (wallet-support.ts); /dev/ui passes filled samples. */
  pairs?: readonly PairSupport[] | undefined;
  /** UTC 'YYYY-MM-DD' of the matrix run, or null before it. */
  checkedOn?: string | null | undefined;
};

/**
 * "Which wallets work" (DECISIONS.md D80): only what the wallet matrix found. Until a pair has run, it says "Not
 * verified yet", and the note above the list says to try with a small stake first (UX rule П10). What a phone
 * wallet can do stays visible (UX rule 10).
 */
export function Wallets({ pairs = WALLET_PAIRS, checkedOn = WALLET_MATRIX_DATE }: WalletsProps) {
  const date = matrixDateText(checkedOn);
  const unverified = date === null || pairs.some((pair) => pair.here === 'not-verified' || pair.link === 'not-verified');
  return (
    <Section id="wallets" title={t('landing.wallets.title')} intro={t('landing.wallets.intro')}>
      {date === null ? null : <p className="text-sm text-muted">{t('landing.wallets.checkedOn', { date })}</p>}
      {unverified ? (
        <p role="note" className="flex max-w-prose items-start gap-2 text-sm font-medium">
          <CircleQuestionMarkIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info" />
          {t('landing.wallets.notVerified')}
        </p>
      ) : null}
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
        {pairs.map((pair) => (
          <PairRow key={pair.id} pair={pair} />
        ))}
      </ul>
      <div className="flex max-w-2xl flex-col gap-2 text-sm">
        <p className="text-pretty">{t('landing.wallets.phone')}</p>
        <p>
          <HashLink href="#faq-ledger">{t('landing.wallets.ledgerLink')}</HashLink>
        </p>
      </div>
    </Section>
  );
}
