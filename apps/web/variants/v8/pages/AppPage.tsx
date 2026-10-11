import type { Address } from '@solana/kit';
import { SproutIcon } from 'lucide-react';
import { Link, useSearchParams } from 'wouter';
import { fetchHealth, type Health } from '@/api/health';
import { Page } from '@/components/layout/Page';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { useSlot } from '@/ports';
import { AlertFromLink } from './alert/AlertFromLink.tsx';
import { AccountsResults } from './app/AccountsResults.tsx';
import { AddressForm, isCheckableAddress } from './app/AddressForm.tsx';
import { ForgetKeys } from './app/ForgetKeys.tsx';
import { ScoreGauge } from '../components/product/score-gauge.tsx';
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
      {/* Opened from a Telegram alert (D125): what it was, before the accounts. */}
      <AlertFromLink wallet={address} />
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
        {address === null ? (
          // v8: before any address, the checklist's empty score card says what will appear here.
          <section
            aria-labelledby="empty-score-title"
            className="grid gap-5 rounded-lg bg-band px-4 py-5 text-on-band sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-8 sm:px-8 sm:py-7"
          >
            <ScoreGauge onBand className="w-36 sm:w-44" />
            <div className="flex max-w-prose flex-col gap-2">
              <h2 id="empty-score-title" className="text-2xl text-balance">
                {t('setupCheck.title')}
              </h2>
              <p className="text-sm text-pretty text-band-muted sm:text-base">
                Paste a wallet to get your score. Stakeward reads its stake accounts from the network and ticks each item it can
                check: locked by a second key, lock not ending soon, the key that manages staking, and more.
              </p>
            </div>
          </section>
        ) : (
          <AccountsResults key={address} address={address} loadHealth={loadHealth} />
        )}
        {/* Stake more SOL of the connected main key (D139): some wallets cannot stake on devnet. Only on its own view. */}
        {main?.ready === true && address === main.slot.address ? (
          <div data-slot="stake-entry">
            <Button asChild variant="outline">
              <Link href="/stake">
                <SproutIcon aria-hidden="true" />
                {t('stake.entry')}
              </Link>
            </Button>
          </div>
        ) : null}
      </div>
      <ForgetKeys />
    </Page>
  );
}
