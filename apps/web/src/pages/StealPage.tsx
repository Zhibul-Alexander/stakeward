import { useState } from 'react';
import { useParams } from 'wouter';
import { Page } from '@/components/layout/Page';
import { PageHeader } from '@/components/layout/PageHeader';
import { t } from '@/i18n';
import { AccountView, InvalidAccountParam, loadedAccount } from '@/pages/account/AccountView';
import { parseAccountParam, useAccountState } from '@/pages/account/load';
import { usePorts } from '@/ports';
import { TheftTest } from './steal/TheftTest.tsx';

/**
 * /try-steal/:account (DECISIONS.md D123): the account, then "Try to steal it": what a thief with only the main key
 * could do to it now, answered by the network through simulation. Read-only, no wallet.
 */
export function StealPage() {
  const params = useParams<{ account: string }>();
  const account = parseAccountParam(params.account);
  const { chain } = usePorts();
  const [attempt, setAttempt] = useState(0);
  const load = useAccountState(chain, account, attempt);
  const loaded = loadedAccount(load);
  return (
    <Page width="flow">
      <PageHeader title={t('common.pages.steal')} lead={t('steal.intro')} />
      {account === null ? (
        <InvalidAccountParam />
      ) : (
        <div className="flex flex-col gap-6">
          <AccountView
            load={load}
            onRetry={() => {
              setAttempt((value) => value + 1);
            }}
          />
          {loaded === null ? null : <TheftTest key={loaded.account.address} chain={chain} account={loaded.account} clock={loaded.clock} />}
        </div>
      )}
    </Page>
  );
}
