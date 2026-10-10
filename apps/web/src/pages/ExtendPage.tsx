import type { Address } from '@solana/kit';
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearch } from 'wouter';
import { Page } from '@/components/layout/Page';
import { PageHeader } from '@/components/layout/PageHeader';
import { useLoad } from '@/hooks/use-load';
import { t } from '@/i18n';
import { AccountView, InvalidAccountParam, loadedAccount } from '@/pages/account/AccountView';
import { checkJobAgain, isLanded } from '@/pages/account/check';
import { parseAccountParam, useAccountState } from '@/pages/account/load';
import { useDeviceClock, usePorts } from '@/ports';
import type { SigningTestOptions } from '@/signing/create';
import type { JobView, SigningState } from '@/signing/machine';
import { choiceText, ExtendChoose } from './extend/ExtendChoose.tsx';
import { ExtendDone } from './extend/ExtendDone.tsx';
import { ExtendSigning } from './extend/ExtendSigning.tsx';
import { choiceLockUntil } from './extend/options.ts';

type ExtendPageProps = {
  /** Tests poll and re-read faster; the product uses the engine's defaults. */
  signing?: SigningTestOptions | undefined;
};

/** A run, fixed when it starts: the lock end it signs (the same on every retry), its words, and the keys. */
type Run = { key: number; lockUntil: bigint; title: string; mainKey: Address; secondKey: Address };

type PageState = { kind: 'choose' } | { kind: 'sign'; run: Run } | { kind: 'done'; run: Run; job: JobView };

/**
 * /extend/:account (F5, live signing only; works in a phone wallet's own browser with the second key alone). The page
 * reads the account with no wallet and offers a later end for the lock or removing it; the second key signs. After a
 * landed run this device remembers the second key (D14), and nothing else: it may not be the main key's device (D37),
 * and monitoring already watches the account (the worker reports the lock change).
 */
export function ExtendPage({ signing }: ExtendPageProps) {
  const params = useParams<{ account: string }>();
  const account = parseAccountParam(params.account);
  const ports = usePorts();
  const { chain } = ports;
  const removeParam = new URLSearchParams(useSearch()).has('remove');
  const deviceClock = useDeviceClock();
  const [attempt, setAttempt] = useState(0);
  // The read's time on this device: ExtendChoose checks the cluster clock against it (SECURITY-CHECK П12).
  const load = useAccountState(chain, account, attempt, deviceClock);
  const loaded = loadedAccount(load);
  const rent0 = useLoad('rent0', () => chain.getMinimumBalanceForRentExemption(0));
  const [selected, setSelected] = useState<string | null>(null);
  const [customDate, setCustomDate] = useState('');
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

  /** The only write: the second key, once the chain shows its lock change. */
  function settle(run: Run, job: JobView) {
    if (isLanded(job)) ports.secondKeys.remember(run.secondKey);
  }

  function onFinished(run: Run, state: SigningState) {
    const job = account === null ? undefined : state.jobs[account];
    if (job === undefined) return;
    settle(run, job);
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
      settle(run, next);
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
      {/* Opened to remove the lock (`?remove`, from /withdraw's fallback): the title says so (DECISIONS.md D112). */}
      <PageHeader
        title={removeParam ? t('extend.removeTitle') : t('common.pages.extend')}
        lead={t('extend.intro')}
        meta={<p>{t('common.neverSeedPhrase')}</p>}
      />
      {account === null ? (
        <InvalidAccountParam />
      ) : (
        <div className="flex flex-col gap-6">
          <AccountView load={load} onRetry={reread} hideNotFound={page.kind === 'done'} />
          {page.kind === 'choose' && loaded !== null ? (
            <ExtendChoose
              headingRef={headingRef}
              loaded={loaded}
              removeParam={removeParam}
              selected={selected}
              onSelect={setSelected}
              customDate={customDate}
              onCustomDate={setCustomDate}
              onReread={reread}
              onContinue={(choice) => {
                start({
                  lockUntil: choiceLockUntil(choice),
                  title: choiceText(choice),
                  mainKey: loaded.account.withdrawer,
                  secondKey: loaded.account.lockup.custodian,
                });
              }}
            />
          ) : null}
          {page.kind === 'sign' ? (
            <ExtendSigning
              headingRef={headingRef}
              title={page.run.title}
              account={account}
              mainKey={page.run.mainKey}
              secondKey={page.run.secondKey}
              lockUntil={page.run.lockUntil}
              runKey={page.run.key}
              rent0={rent0}
              signing={signing}
              onFinished={(state) => {
                onFinished(page.run, state);
              }}
              onCheckAgain={() => {
                start(page.run);
              }}
              onBack={back}
            />
          ) : null}
          {page.kind === 'done' ? (
            <ExtendDone
              headingRef={headingRef}
              account={account}
              mainKey={page.run.mainKey}
              lockUntil={page.run.lockUntil}
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
