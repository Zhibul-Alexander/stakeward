import type { Address } from '@solana/kit';
import { isLockupInForce } from '@stakeward/core';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'wouter';
import { Page } from '@/components/layout/Page';
import { PageHeader } from '@/components/layout/PageHeader';
import { RiskNote } from '@/components/product/risk-note';
import { useThrottledCall } from '@/hooks/use-throttled-call';
import { t } from '@/i18n';
import { AccountView, InvalidAccountParam, loadedAccount, type LoadedAccount } from '@/pages/account/AccountView';
import { checkJobAgain, isLanded } from '@/pages/account/check';
import { parseAccountParam, useAccountState } from '@/pages/account/load';
import { appLinks } from '@/pages/app/view';
import { useChain } from '@/ports';
import type { SigningTestOptions } from '@/signing/create';
import type { JobView, SigningState } from '@/signing/machine';
import type { SignMode } from '@/signing/SignWhere';
import { StageBlock, withdrawTitle } from './withdraw/StageBlock.tsx';
import { WithdrawDone } from './withdraw/WithdrawDone.tsx';
import { WithdrawSigning, type WithdrawWhat } from './withdraw/WithdrawSigning.tsx';

type WithdrawPageProps = {
  /** Tests poll and re-read faster; the product uses the engine's defaults. */
  signing?: SigningTestOptions | undefined;
};

/**
 * The keys of a run, fixed when it starts: who signs, where the second key signs (`link` only for a withdrawal it
 * co-signs) and what the signing section is titled.
 */
type Run = { what: WithdrawWhat; key: number; title: string; mainKey: Address; secondKey: Address | null; mode: SignMode };

type PageState = { kind: 'view' } | { kind: 'sign'; run: Run } | { kind: 'done'; run: Run; job: JobView };

/** The countdown's own re-read runs at most this often (a wrong epoch estimate must not loop). */
const AUTO_REREAD_MS = 20_000;

/** Who signs a run on this account as read now: the main key, and the second key while its lock is in force. */
function keysOf(loaded: LoadedAccount): { mainKey: Address; secondKey: Address | null } {
  const { account, clock } = loaded;
  return { mainKey: account.withdrawer, secondKey: isLockupInForce(account.lockup, clock) ? account.lockup.custodian : null };
}

/**
 * /withdraw/:account (F3, live signing only). Look first (UX rule 1): the page reads the account with no wallet, says
 * where it stands and offers one action; the engine asks for the wallets when they must sign. Every finished run reads
 * the account again, so the page shows what the chain shows. Nothing is written to this device.
 */
export function WithdrawPage({ signing }: WithdrawPageProps) {
  const params = useParams<{ account: string }>();
  const account = parseAccountParam(params.account);
  const chain = useChain();
  const [attempt, setAttempt] = useState(0);
  const load = useAccountState(chain, account, attempt);
  const loaded = loadedAccount(load);
  const [page, setPage] = useState<PageState>({ kind: 'view' });
  // Where the second key signs a withdrawal (step 7 spec 10.2); kept across runs and Back.
  const [secondMode, setSecondMode] = useState<SignMode>('here');
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const runKey = useRef(0);
  const checkOp = useRef(0);

  // Focus follows the page (UX rule 2): the heading of what is shown now, never on the first render. After the user's
  // own Check again it waits for the fresh read, whose stage heading takes it.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shown = useRef(page.kind);
  const focusPending = useRef(false);
  useEffect(() => {
    if (shown.current !== page.kind) {
      shown.current = page.kind;
      focusPending.current = true;
    }
    if (!focusPending.current || headingRef.current === null) return;
    focusPending.current = false;
    headingRef.current.focus();
  }, [page.kind, load]);

  const reread = () => {
    setAttempt((value) => value + 1);
  };
  // The countdown ran out: read again, at most once per AUTO_REREAD_MS. An end inside that window (an estimate that was
  // a little early leaves a few seconds to count) reads again when the window ends, so the page never stays at "Ended".
  const autoReread = useThrottledCall(reread, AUTO_REREAD_MS);

  function start(what: WithdrawWhat, keys: { mainKey: Address; secondKey: Address | null }, lamports: bigint) {
    runKey.current += 1;
    setCheckFailed(false);
    // Only a withdrawal the second key co-signs can go by link; a deactivation and a lone main key sign here.
    const mode: SignMode = what === 'withdraw' && keys.secondKey !== null ? secondMode : 'here';
    const { mainKey, secondKey } = keys;
    setPage({ kind: 'sign', run: { what, key: runKey.current, title: withdrawTitle(what, lamports), mainKey, secondKey, mode } });
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
    setPage({ kind: 'view' });
  }

  const landedDeactivate = page.kind === 'done' && page.run.what === 'deactivate' && isLanded(page.job);
  return (
    <Page width="flow">
      <PageHeader title={t('common.pages.withdraw')} lead={t('withdraw.intro')} meta={<p>{t('common.neverSeedPhrase')}</p>} />
      {account === null ? (
        <InvalidAccountParam />
      ) : (
        <div className="flex flex-col gap-6">
          <AccountView load={load} onRetry={reread} hideNotFound={page.kind === 'done'} />
          {loaded === null ? null : (
            <RiskNote risk="withdraw-compromised">
              <p>
                <Link
                  href={appLinks.rescue(loaded.account.withdrawer)}
                  className="rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
                >
                  {t('withdraw.rescueLink')}
                </Link>
              </p>
            </RiskNote>
          )}
          {page.kind === 'sign' ? (
            <WithdrawSigning
              headingRef={headingRef}
              title={page.run.title}
              what={page.run.what}
              account={account}
              mainKey={page.run.mainKey}
              secondKey={page.run.secondKey}
              mode={page.run.mode}
              runKey={page.run.key}
              signing={signing}
              onFinished={(state) => {
                onFinished(page.run, state);
              }}
              onBack={back}
            />
          ) : null}
          {page.kind === 'done' ? (
            <WithdrawDone
              headingRef={headingRef}
              what={page.run.what}
              job={page.job}
              mainKey={page.run.mainKey}
              byLink={page.run.mode === 'link'}
              signing={signing}
              checking={checking}
              checkFailed={checkFailed}
              onRetry={() => {
                const { run } = page;
                start(run.what, loaded === null ? run : keysOf(loaded), loaded?.account.lamports ?? page.job.before?.lamports ?? 0n);
              }}
              onCheckAgain={() => void checkAgain(page.run, page.job)}
              onBack={back}
            />
          ) : null}
          {loaded !== null && (page.kind === 'view' || landedDeactivate) ? (
            <StageBlock
              headingRef={page.kind === 'view' ? headingRef : null}
              loaded={loaded}
              onSign={(what) => {
                start(what, keysOf(loaded), loaded.account.lamports);
              }}
              secondMode={secondMode}
              onSecondMode={setSecondMode}
              onCheckAgain={() => {
                // After a deactivation, Check again leaves its Done note behind: the fresh read says where it stands.
                if (page.kind !== 'view') back();
                focusPending.current = true;
                reread();
              }}
              onCountdownEnd={autoReread}
            />
          ) : null}
        </div>
      )}
    </Page>
  );
}
