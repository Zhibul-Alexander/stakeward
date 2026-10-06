import type { Address } from '@solana/kit';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'wouter';
import { RoleNamesProvider, type RoleNames } from '@/components/product/wallet-slot';
import { useLoad } from '@/hooks/use-load';
import { t } from '@/i18n';
import { AccountView, InvalidAccountParam, loadedAccount } from '@/pages/account/AccountView';
import { checkJobAgain, isLanded } from '@/pages/account/check';
import { parseAccountParam, useAccountState } from '@/pages/account/load';
import { usePorts, type Ports } from '@/ports';
import type { SigningTestOptions } from '@/signing/create';
import type { JobView, SigningState } from '@/signing/machine';
import { SecondKeyChoose } from './second-key/SecondKeyChoose.tsx';
import { SecondKeyDone } from './second-key/SecondKeyDone.tsx';
import { SecondKeySigning } from './second-key/SecondKeySigning.tsx';

type SecondKeyPageProps = {
  /** Tests poll and re-read faster; the product uses the engine's defaults. */
  signing?: SigningTestOptions | undefined;
};

/** A run, fixed when it starts: the keys it signs with (the same on every retry). */
type Run = { key: number; mainKey: Address; secondKey: Address; newSecondKey: Address };

type PageState = { kind: 'choose' } | { kind: 'sign'; run: Run } | { kind: 'done'; run: Run; job: JobView };

/**
 * The new second key fills the New wallet slot (CLAUDE.md section 6 keeps three slots), named for what it is here.
 * Every slot, signer list and summary on this page says "New second key"; /rescue keeps "New wallet".
 */
const ROLE_NAMES: RoleNames = {
  new: { label: 'common.roles.newSecond', switchAccount: 'components.walletSlot.switch.newSecond' },
};

/**
 * /second-key/:account (F7, live signing only): the second key that holds the lock hands it to a new second key, which
 * signs too; the lock keeps its end. The page reads the account with no wallet; the new second key is a wallet the user
 * connects, never a typed address. Once the chain shows the change, this device takes the new key as a second key and
 * no longer the old one (`settle`).
 */
export function SecondKeyPage({ signing }: SecondKeyPageProps) {
  const params = useParams<{ account: string }>();
  const account = parseAccountParam(params.account);
  const ports = usePorts();
  const { chain } = ports;
  const [attempt, setAttempt] = useState(0);
  const load = useAccountState(chain, account, attempt);
  const loaded = loadedAccount(load);
  const rent0 = useLoad('rent0', () => chain.getMinimumBalanceForRentExemption(0));
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

  function onFinished(run: Run, state: SigningState) {
    const job = account === null ? undefined : state.jobs[account];
    if (job === undefined) return;
    if (isLanded(job)) settle(ports, run);
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
      if (isLanded(next)) settle(ports, run);
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
    <RoleNamesProvider names={ROLE_NAMES}>
      <div className="flex flex-col gap-8">
        <div className="flex max-w-2xl flex-col gap-2">
          <h1 className="text-3xl font-semibold">{t('common.pages.secondKey')}</h1>
          <p className="text-muted">{t('secondKey.intro')}</p>
          <p className="text-sm font-medium">{t('common.neverSeedPhrase')}</p>
        </div>
        {account === null ? (
          <InvalidAccountParam />
        ) : (
          <div className="flex flex-col gap-6">
            <AccountView load={load} onRetry={reread} hideNotFound={page.kind === 'done'} />
            {page.kind === 'choose' && loaded !== null ? (
              <SecondKeyChoose
                headingRef={headingRef}
                loaded={loaded}
                seedConfirmed={seedConfirmed}
                onSeed={setSeedConfirmed}
                onContinue={(newSecondKey) => {
                  start({
                    mainKey: loaded.account.withdrawer,
                    secondKey: loaded.account.lockup.custodian,
                    newSecondKey,
                  });
                }}
              />
            ) : null}
            {page.kind === 'sign' ? (
              <SecondKeySigning
                headingRef={headingRef}
                account={account}
                mainKey={page.run.mainKey}
                secondKey={page.run.secondKey}
                newSecondKey={page.run.newSecondKey}
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
              <SecondKeyDone
                headingRef={headingRef}
                account={account}
                secondKey={page.run.secondKey}
                newSecondKey={page.run.newSecondKey}
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
      </div>
    </RoleNamesProvider>
  );
}

/**
 * The only writes, once the chain shows the new second key holding the lock: this device knows it as a second key, and
 * no longer the old one (it may be stolen; /app then never shows a lock it holds as Protected). The slots follow: the
 * old key leaves the Second key slot, and the new key moves there from the New wallet slot it was connected in, so
 * /extend and /withdraw find it under its role and /rescue finds the New wallet slot free.
 */
function settle(ports: Pick<Ports, 'secondKeys' | 'slots'>, run: Run): void {
  ports.secondKeys.forget(run.secondKey);
  ports.secondKeys.remember(run.newSecondKey);
  const { slots } = ports;
  const before = slots.getSnapshot();
  if (before.second?.address === run.secondKey) slots.clear('second');
  const moved = before.new;
  if (moved?.address === run.newSecondKey) {
    slots.clear('new');
    if (slots.getSnapshot().second === null) slots.assign('second', moved);
  }
}
