import type { Address } from '@solana/kit';
import { SproutIcon } from 'lucide-react';
import { Link, useSearchParams } from 'wouter';
import { fetchHealth, type Health } from '@/api/health';
import { Page } from '@/components/layout/Page';
import { AddressText } from '@/components/product/address-text';
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

  // v6 "Verdict first": with an address, the question is a quiet line and the answer is the page; without one, the
  // page is the question and the field.
  return (
    <Page width="app">
      {address === null ? (
        <>
          <div className="flex flex-col gap-4"><h1 className="max-w-5xl text-4xl text-balance">{t('app.title')}</h1><p className="max-w-prose text-lg text-muted">{t('app.intro')}</p></div>
          <div className="max-w-4xl">{form}</div>
        </>
      ) : (
        <>
          <div className="-mb-4 flex flex-col gap-2 sm:-mb-8">
            <h1 className="text-2xl">Can a thief take this staked SOL?</h1>
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
              <span>{t('app.form.label')}</span>
              <AddressText address={address} />
              <a href="#check-another" className="rounded-sm font-medium text-foreground underline underline-offset-4">
                Check another wallet
              </a>
            </p>
          </div>
          {/* Opened from a Telegram alert (D125): what it was, before the answer. */}
          <AlertFromLink wallet={address} />
          <AccountsResults key={address} address={address} loadHealth={loadHealth} />
          {/* Stake more SOL of the connected main key (D139). Only on its own view. */}
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
          <section id="check-another" aria-labelledby="check-another-title" className="flex max-w-4xl scroll-mt-4 flex-col gap-4 border-t-2 border-foreground pt-6">
            <h2 id="check-another-title" className="text-2xl">
              Check another wallet
            </h2>
            {form}
          </section>
        </>
      )}
      <ForgetKeys />
    </Page>
  );
}
