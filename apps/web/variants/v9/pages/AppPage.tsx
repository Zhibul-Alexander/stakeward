import type { Address } from '@solana/kit';
import { shortAddress } from '@stakeward/core';
import { SproutIcon } from 'lucide-react';
import { Link, useSearchParams } from 'wouter';
import { fetchHealth, type Health } from '@/api/health';
import { FromVisitor, Page } from '@/components/layout/Page';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { useSlot } from '@/ports';
import { AlertFromLink } from './alert/AlertFromLink.tsx';
import { AccountsResults } from './app/AccountsResults.tsx';
import { AddressForm, isCheckableAddress } from './app/AddressForm.tsx';
import { ForgetKeys } from './app/ForgetKeys.tsx';
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

  const fromMainKey = query === null && address !== null;
  const form = (
    <AddressForm
      // The address shown, also when it comes from the connected main key rather than the URL.
      value={query ?? address ?? ''}
      resultsFor={address}
      onSubmit={show}
      emphasis={address === null ? 'primary' : 'outline'}
      aside={<KeySlot role="main" layout="inline" connectLabel={t('app.connect.mainButton')} onConnected={show} />}
    />
  );

  /*
   * v9: the accounts page is the conversation's next turn. Stakeward asks (the header bubble); with no address yet the
   * composer answers right under it. With one, the visitor's question stands as their bubble, Stakeward replies with
   * the summary, the accounts as attachments and suggested replies, and the composer waits at the foot of the thread to
   * ask about another address.
   */
  return (
    <Page width="app">
      <PageHeader title={t('app.title')} lead={t('app.intro')} />
      {/* Opened from a Telegram alert (D125): what it was, before the accounts. */}
      <AlertFromLink wallet={address} />
      {address === null ? (
        <div className="sm:pl-12">{form}</div>
      ) : (
        <>
          <FromVisitor>
            {fromMainKey ? (
              'What is protected in my wallet?'
            ) : (
              <>
                What is protected in <span className="font-mono">{shortAddress(address)}</span>?
              </>
            )}
          </FromVisitor>
          <AccountsResults key={address} address={address} loadHealth={loadHealth} />
          {/* Stake more SOL of the connected main key (D139): some wallets cannot stake on devnet. Only on its own view. */}
          {main?.ready === true && address === main.slot.address ? (
            <div data-slot="stake-entry" className="flex justify-end">
              <Button asChild variant="outline">
                <Link href="/stake">
                  <SproutIcon aria-hidden="true" />
                  {t('stake.entry')}
                </Link>
              </Button>
            </div>
          ) : null}
          <div className="flex flex-col gap-2 border-t border-border pt-6">
            <p className="px-1 text-sm text-muted">Ask about another address</p>
            {form}
          </div>
        </>
      )}
      <ForgetKeys />
    </Page>
  );
}
