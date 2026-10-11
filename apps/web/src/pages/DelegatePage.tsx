import type { Address } from '@solana/kit';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'wouter';
import { Page } from '@/components/layout/Page';
import { PageHeader } from '@/components/layout/PageHeader';
import { t } from '@/i18n';
import { AccountView, InvalidAccountParam, loadedAccount } from '@/pages/account/AccountView';
import { checkJobAgain } from '@/pages/account/check';
import { parseAccountParam, useAccountState } from '@/pages/account/load';
import { useDeviceClock, usePorts } from '@/ports';
import type { SigningTestOptions } from '@/signing/create';
import type { JobView, SigningState } from '@/signing/machine';
import { DelegateChoose } from './delegate/DelegateChoose.tsx';
import { DelegateDone } from './delegate/DelegateDone.tsx';
import { DelegateSigning } from './delegate/DelegateSigning.tsx';

type DelegatePageProps = {
  /** Tests poll and re-read faster; the product uses the engine's defaults. */
  signing?: SigningTestOptions | undefined;
};

/** A run, fixed when it starts: the main key that signs and the validator. */
type Run = { key: number; mainKey: Address; voteAccount: Address };

type PageState = { kind: 'choose' } | { kind: 'sign'; run: Run } | { kind: 'done'; run: Run; job: JobView };

/**
 * /delegate/:account (DECISIONS.md D134): an inactive stake earns nothing, so delegate it to a validator. The page reads
 * the account with no wallet and offers validators that meet open criteria in random order; the main key signs and
 * pays. The lock stays as it is.
 */
export function DelegatePage({ signing }: DelegatePageProps) {
  const params = useParams<{ account: string }>();
  const account = parseAccountParam(params.account);
  const { chain } = usePorts();
  const deviceClock = useDeviceClock();
  const [attempt, setAttempt] = useState(0);
  const load = useAccountState(chain, account, attempt, deviceClock);
  const loaded = loadedAccount(load);
  const [page, setPage] = useState<PageState>({ kind: 'choose' });
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const runKey = useRef(0);
  const checkOp = useRef(0);

  // Focus follows the page (UX rule 2): the heading of what is shown now, never on the first render.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shown = useRef(page.kind);
  useEffect(() => {
    if (shown.current === page.kind) return;
    shown.current = page.kind;
    headingRef.current?.focus();
  }, [page.kind]);

  const reread = () => {
    setAttempt((value) => value + 1);
  };

  function start(run: Omit<Run, 'key'>) {
    runKey.current += 1;
    setCheckFailed(false);
    setPage({ kind: 'sign', run: { ...run, key: runKey.current } });
  }

  function onFinished(run: Run, state: SigningState) {
    const job = account === null ? undefined : state.jobs[account];
    if (job === undefined) return;
    setPage({ kind: 'done', run, job });
    setAttempt((value) => value + 1);
  }

  async function checkAgain(run: Run, job: JobView) {
    checkOp.current += 1;
    const op = checkOp.current;
    setChecking(true);
    setCheckFailed(false);
    try {
      const next = await checkJobAgain(chain, job);
      if (op !== checkOp.current) return;
      setPage((current) => (current.kind === 'done' && current.run.key === run.key ? { ...current, job: next } : current));
      setAttempt((value) => value + 1);
    } catch {
      if (op === checkOp.current) setCheckFailed(true);
    } finally {
      if (op === checkOp.current) setChecking(false);
    }
  }

  function back() {
    checkOp.current += 1;
    setChecking(false);
    setCheckFailed(false);
    setPage({ kind: 'choose' });
  }

  return (
    <Page width="flow">
      <PageHeader title={t('common.pages.delegate')} lead={t('delegate.intro')} meta={<p>{t('common.neverSeedPhrase')}</p>} />
      {account === null ? (
        <InvalidAccountParam />
      ) : (
        <div className="flex flex-col gap-6">
          <AccountView load={load} onRetry={reread} hideNotFound={page.kind === 'done'} />
          {page.kind === 'choose' && loaded !== null ? (
            <DelegateChoose
              headingRef={headingRef}
              loaded={loaded}
              onContinue={(voteAccount) => {
                start({ mainKey: loaded.account.withdrawer, voteAccount });
              }}
            />
          ) : null}
          {page.kind === 'sign' ? (
            <DelegateSigning
              headingRef={headingRef}
              account={account}
              mainKey={page.run.mainKey}
              voteAccount={page.run.voteAccount}
              runKey={page.run.key}
              signing={signing}
              onFinished={(state) => {
                onFinished(page.run, state);
              }}
              onBack={back}
            />
          ) : null}
          {page.kind === 'done' ? (
            <DelegateDone
              headingRef={headingRef}
              mainKey={page.run.mainKey}
              voteAccount={page.run.voteAccount}
              job={page.job}
              checking={checking}
              checkFailed={checkFailed}
              onRetry={() => {
                start(page.run);
              }}
              onCheckAgain={() => void checkAgain(page.run, page.job)}
              onBack={back}
            />
          ) : null}
        </div>
      )}
    </Page>
  );
}
