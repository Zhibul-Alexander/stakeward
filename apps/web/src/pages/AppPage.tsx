import type { Address } from '@solana/kit';
import { useSearchParams } from 'wouter';
import { fetchHealth, type Health } from '@/api/health';
import { Page } from '@/components/layout/Page';
import { PageHeader } from '@/components/layout/PageHeader';
import { t } from '@/i18n';
import { useSlot } from '@/ports';
import { AccountsResults } from './app/AccountsResults.tsx';
import { AddressForm, isCheckableAddress } from './app/AddressForm.tsx';
import { KeySlot } from './app/KeySlot.tsx';

const loadHealthFromWorker = () => fetchHealth();

type AppPageProps = {
  /** GET /api/health; tests pass their own. */
  loadHealth?: (() => Promise<Health>) | undefined;
};

/**
 * /app: stake accounts and their status (CLAUDE.md sections 5 and 9). Works by address without a wallet
 * (/app?address=), or with the main key connected. The address lives in the URL, so a reload shows the same stake,
 * read fresh from the chain.
 */
export function AppPage({ loadHealth = loadHealthFromWorker }: AppPageProps) {
  const [params, setParams] = useSearchParams();
  const query = params.get('address');
  const main = useSlot('main');
  // An address in the URL wins; without one, a connected main key shows its own stake.
  const address: Address | null =
    query === null ? (main?.ready === true ? main.slot.address : null) : isCheckableAddress(query) ? query : null;

  const show = (next: Address) => {
    setParams({ address: next });
  };

  return (
    <Page width="app">
      <PageHeader title={t('app.title')} lead={t('app.intro')} />
      {/* The form and what it shows are one block: the answer starts right under the field. */}
      <div className="flex flex-col gap-6 sm:gap-8">
        <AddressForm
          // The address shown, also when it comes from the connected main key rather than the URL.
          value={query ?? address ?? ''}
          resultsFor={address}
          onSubmit={show}
          emphasis={address === null ? 'primary' : 'outline'}
          aside={<KeySlot role="main" layout="inline" connectLabel={t('app.connect.mainButton')} onConnected={show} />}
        />
        {address === null ? null : <AccountsResults key={address} address={address} loadHealth={loadHealth} />}
      </div>
    </Page>
  );
}
