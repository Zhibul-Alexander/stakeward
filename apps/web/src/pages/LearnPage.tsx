import { Link, useParams } from 'wouter';
import { Page } from '@/components/layout/Page';
import type { Load } from '@/hooks/use-load';
import { PageHeader } from '@/components/layout/PageHeader';
import { t, type MessageKey } from '@/i18n';
import { Alerts } from './landing/Alerts.tsx';
import { useNonceDeposit } from './landing/deposit.ts';
import { Faq } from './landing/Faq.tsx';
import { useFaqParams } from './landing/faq.ts';
import { Fees } from './landing/Fees.tsx';
import { Security } from './landing/Security.tsx';
import { useHashTarget } from './landing/use-hash-target.ts';
import { Wallets } from './landing/Wallets.tsx';

export const LEARN_TABS = ['faq', 'alerts', 'costs', 'wallets', 'safety'] as const;
export type LearnTab = (typeof LEARN_TABS)[number];

const TAB_LABEL: Record<LearnTab, MessageKey> = {
  faq: 'learn.tabs.faq',
  alerts: 'learn.tabs.alerts',
  costs: 'learn.tabs.costs',
  wallets: 'learn.tabs.wallets',
  safety: 'learn.tabs.safety',
};

/** Where a landing anchor of the old one-page layout lives now (`/#faq-ledger` -> `/learn/faq#faq-ledger`). */
export function learnPathForHash(hash: string): string | null {
  if (hash.startsWith('#faq-') || hash === '#faq') return `/learn/faq${hash}`;
  if (hash === '#alerts') return '/learn/alerts';
  if (hash === '#fees') return '/learn/costs';
  if (hash === '#wallets') return '/learn/wallets';
  if (hash === '#security' || hash === '#recover') return `/learn/safety${hash}`;
  return null;
}

/**
 * /learn/:tab: the details the landing page used to carry in one long scroll (alerts, costs, wallets, how Stakeward
 * keeps you safe, the FAQ), one tab at a time. The tabs are links, so each has its own address and a hash such as
 * `/learn/faq#faq-ledger` opens its question. An unknown tab shows the FAQ.
 */
export function LearnPage() {
  const params = useParams<{ tab?: string }>();
  const tab = LEARN_TABS.find((candidate) => candidate === params.tab) ?? 'faq';
  useHashTarget();
  const deposit = useNonceDeposit();
  const faqParams = useFaqParams(deposit);
  return (
    <Page>
      <PageHeader title={t('learn.title')} lead={t('learn.lead')} />
      <nav aria-label={t('learn.tabs.label')} className="-mt-4 flex flex-wrap gap-2 border-b border-border pb-3">
        {LEARN_TABS.map((id) => (
          <Link
            key={id}
            href={`/learn/${id}`}
            aria-current={id === tab ? 'page' : undefined}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-muted hover:bg-subtle hover:text-foreground aria-[current=page]:bg-subtle aria-[current=page]:text-foreground"
          >
            {t(TAB_LABEL[id])}
          </Link>
        ))}
      </nav>
      <LearnTabBody tab={tab} deposit={deposit} params={faqParams} />
    </Page>
  );
}

/** What one tab shows. */
export function LearnTabBody({ tab, deposit, params }: { tab: LearnTab; deposit: Load<bigint>; params: Readonly<Record<string, string>> }) {
  switch (tab) {
    case 'faq':
      return <Faq params={params} />;
    case 'alerts':
      return <Alerts params={params} />;
    case 'costs':
      return <Fees deposit={deposit} />;
    case 'wallets':
      return <Wallets />;
    case 'safety':
      return <Security />;
  }
}
