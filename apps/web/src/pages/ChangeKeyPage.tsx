import type { Address } from '@solana/kit';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'wouter';
import { Page } from '@/components/layout/Page';
import { PageHeader } from '@/components/layout/PageHeader';
import { t } from '@/i18n';
import { AccountView, InvalidAccountParam, loadedAccount } from '@/pages/account/AccountView';
import { checkJobAgain, isLanded } from '@/pages/account/check';
import { parseAccountParam, useAccountState } from '@/pages/account/load';
import { useDeviceClock, usePorts } from '@/ports';
import type { SigningTestOptions } from '@/signing/create';
import type { JobView, SigningState } from '@/signing/machine';
import { ChangeKeyChoose } from './change-key/ChangeKeyChoose.tsx';
import { ChangeKeyDone } from './change-key/ChangeKeyDone.tsx';
import { ChangeKeySigning } from './change-key/ChangeKeySigning.tsx';

type ChangeKeyPageProps = {
  /** Tests poll and re-read faster; the product uses the engine's defaults. */
  signing?: SigningTestOptions | undefined;
};

/** A run, fixed when it starts: the keys it signs with. */
type Run = { key: number; mainKey: Address; secondKey: Address; newKey: Address };

type PageState = { kind: 'choose' } | { kind: 'sign'; run: Run } | { kind: 'done'; run: Run; job: JobView };

/**
 * /change-key/:account (F7, live signing only): hand the lock to a new second key, for a second key that may be stolen.
 * The page reads the account with no wallet; the second key that holds the lock and a new wallet from a new seed phrase
 * sign, and the new one pays. The lock's end stays. After a landed run this device remembers the new second key (D14).
 */
export function ChangeKeyPage({ signing }: ChangeKeyPageProps) {
  const params = useParams<{ account: string }>();
  const account = parseAccountParam(params.account);
  const ports = usePorts();
  const { chain } = ports;
  const deviceClock = useDeviceClock();
  const [attempt, setAttempt] = useState(0);
  const load = useAccountState(chain, account, attempt, deviceClock);
  const loaded = loadedAccount(load);
  const [seedConfirmed, setSeedConfirmed] = useState(false);
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

  /** The only write: the new second key, once the chain shows it holds the lock. */
  function settle(run: Run, job: JobView) {
    if (isLanded(job)) ports.secondKeys.remember(run.newKey);
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
      <PageHeader title={t('common.pages.changeKey')} lead={t('changeKey.intro')} meta={<p>{t('common.neverSeedPhrase')}</p>} />
      {account === null ? (
        <InvalidAccountParam />
      ) : (
        <div className="flex flex-col gap-6">
          <AccountView load={load} onRetry={reread} hideNotFound={page.kind === 'done'} />
          {page.kind === 'choose' && loaded !== null ? (
            <ChangeKeyChoose
              headingRef={headingRef}
              loaded={loaded}
              seedConfirmed={seedConfirmed}
              onSeed={setSeedConfirmed}
              onContinue={(newKey) => {
                start({ mainKey: loaded.account.withdrawer, secondKey: loaded.account.lockup.custodian, newKey });
              }}
            />
          ) : null}
          {page.kind === 'sign' ? (
            <ChangeKeySigning
              headingRef={headingRef}
              account={account}
              mainKey={page.run.mainKey}
              secondKey={page.run.secondKey}
              newKey={page.run.newKey}
              runKey={page.run.key}
              signing={signing}
              onFinished={(state) => {
                onFinished(page.run, state);
              }}
              onBack={back}
            />
          ) : null}
          {page.kind === 'done' ? (
            <ChangeKeyDone
              headingRef={headingRef}
              account={account}
              mainKey={page.run.mainKey}
              newKey={page.run.newKey}
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
