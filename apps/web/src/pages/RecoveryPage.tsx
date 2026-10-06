import { shortAddress } from '@stakeward/core';
import { PrinterIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { Button } from '@/components/ui/button';
import { CLUSTER } from '@/config';
import { t } from '@/i18n';
import { AccountView, InvalidAccountParam, loadedAccount } from '@/pages/account/AccountView';
import { parseAccountParam, useAccountState } from '@/pages/account/load';
import { usePorts } from '@/ports';
import { recoveryCard } from './recovery/card.ts';
import { NoRecoveryCard, RecoveryCardView } from './recovery/RecoveryCardView.tsx';

/**
 * /recovery/:account, the recovery card (CLAUDE.md section 9): what the owner does in each case, with Stakeward and
 * without it, for one stake account. Read from the chain with no wallet; nothing is signed or stored. Print or save it
 * as a PDF: the site frame and the buttons are left off the paper.
 */
export function RecoveryPage() {
  const params = useParams<{ account: string }>();
  const account = parseAccountParam(params.account);
  const { chain } = usePorts();
  const [attempt, setAttempt] = useState(0);
  const load = useAccountState(chain, account, attempt);
  const loaded = loadedAccount(load);
  const result = loaded === null ? null : recoveryCard(loaded.account, loaded.clock, CLUSTER);

  // The tab title, and the file name a browser suggests for "Save as PDF": one per stake account.
  useEffect(() => {
    if (account === null) return undefined;
    const previous = document.title;
    document.title = t('recovery.documentTitle', { account: shortAddress(account) });
    return () => {
      document.title = previous;
    };
  }, [account]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex max-w-2xl flex-col gap-3">
        <h1 className="text-3xl font-semibold">{t('common.pages.recovery')}</h1>
        <p className="text-muted">{t('recovery.intro')}</p>
        {result?.kind === 'card' ? (
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button
              onClick={() => {
                window.print();
              }}
            >
              <PrinterIcon aria-hidden="true" />
              {t('recovery.print')}
            </Button>
            <Button asChild variant="outline">
              <Link href={`/app?${new URLSearchParams({ address: result.card.mainKey }).toString()}`}>
                {t('common.backToAccounts')}
              </Link>
            </Button>
          </div>
        ) : null}
      </div>
      {account === null ? (
        <InvalidAccountParam />
      ) : loaded === null || result === null ? (
        <AccountView
          load={load}
          onRetry={() => {
            setAttempt((value) => value + 1);
          }}
        />
      ) : result.kind === 'none' ? (
        <NoRecoveryCard
          account={loaded.account.address}
          reason={result.reason}
          date={result.date}
          mainKey={loaded.account.withdrawer}
        />
      ) : (
        <RecoveryCardView card={result.card} cluster={CLUSTER} readAt={loaded.clock.unixTimestamp} siteOrigin={window.location.origin} />
      )}
    </div>
  );
}
