import { CircleQuestionMarkIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { SupportBadge } from '@/components/product/support-badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { t } from '@/i18n';
import { HashLink, Section } from './Section.tsx';
import { matrixDateText, WALLET_MATRIX_DATE, WALLET_PAIRS, type PairSupport, type WalletSetup } from './wallet-support.ts';

const setupName = (setup: WalletSetup) => t(`landing.wallets.setups.${setup}`);

/** One row of a pair's card: the term above its value on a phone, beside it from `sm` up. */
function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:grid sm:grid-cols-2 sm:items-center sm:gap-3">
      <dt className="text-muted">{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function PairCard({ pair }: { pair: PairSupport }) {
  return (
    <li data-pair={pair.id} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h3 className="font-semibold">{t('landing.wallets.pairLabel', { main: setupName(pair.main), second: setupName(pair.second) })}</h3>
      <dl className="flex flex-col gap-2 text-sm">
        <Row term={t('common.roles.main')}>{setupName(pair.main)}</Row>
        <Row term={t('common.roles.second')}>{setupName(pair.second)}</Row>
        <Row term={t('landing.wallets.here')}>
          <SupportBadge verdict={pair.here} />
        </Row>
        <Row term={t('landing.wallets.link')}>
          <SupportBadge verdict={pair.link} />
        </Row>
      </dl>
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
 * verified yet", and the note above the table says to try with a small stake first (UX rule П10).
 */
export function Wallets({ pairs = WALLET_PAIRS, checkedOn = WALLET_MATRIX_DATE }: WalletsProps) {
  const date = matrixDateText(checkedOn);
  const unverified = date === null || pairs.some((pair) => pair.here === 'not-verified' || pair.link === 'not-verified');
  return (
    <Section id="wallets" title={t('landing.wallets.title')}>
      <div className="flex max-w-prose flex-col gap-2">
        <p>{t('landing.wallets.intro')}</p>
        {date === null ? null : <p className="text-sm text-muted">{t('landing.wallets.checkedOn', { date })}</p>}
      </div>
      {unverified ? (
        <Alert tone="info" role="note" className="max-w-prose">
          <CircleQuestionMarkIcon aria-hidden="true" />
          <AlertDescription className="text-foreground">
            <p>{t('landing.wallets.notVerified')}</p>
          </AlertDescription>
        </Alert>
      ) : null}
      <ul className="grid gap-3 md:grid-cols-2">
        {pairs.map((pair) => (
          <PairCard key={pair.id} pair={pair} />
        ))}
      </ul>
      <div className="flex max-w-prose flex-col gap-2">
        <p>{t('landing.wallets.phone')}</p>
        <p>
          <HashLink href="#faq-ledger">{t('landing.wallets.ledgerLink')}</HashLink>
        </p>
      </div>
    </Section>
  );
}
