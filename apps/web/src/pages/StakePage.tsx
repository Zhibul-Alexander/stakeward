import type { Address } from '@solana/kit';
import { deriveStakeAccountAddress, newStakeAccountSeed } from '@stakeward/core';
import { useEffect, useRef, useState } from 'react';
import { Page } from '@/components/layout/Page';
import { PageHeader } from '@/components/layout/PageHeader';
import { t } from '@/i18n';
import { checkJobAgain } from '@/pages/account/check';
import { KeySlot } from '@/pages/app/KeySlot';
import { usePorts, useSlot } from '@/ports';
import type { SigningTestOptions } from '@/signing/create';
import type { JobView, SigningState } from '@/signing/machine';
import { StakeChoose } from './stake/StakeChoose.tsx';
import { StakeDone } from './stake/StakeDone.tsx';
import { StakeSigning } from './stake/StakeSigning.tsx';

type StakePageProps = {
  /** Tests poll and re-read faster; the product uses the engine's defaults. */
  signing?: SigningTestOptions | undefined;
  /** The seed's clock; tests pass a fixed one. */
  now?: (() => number) | undefined;
};

/** A run, fixed when it starts: the new account's address and seed, what moves into it and the validator. */
type Run = {
  key: number;
  mainKey: Address;
  stakeAccount: Address;
  seed: string;
  lamports: bigint;
  voteAccount: Address | null;
};

type PageState = { kind: 'choose' } | { kind: 'sign'; run: Run } | { kind: 'done'; run: Run; job: JobView };

/**
 * /stake (DECISIONS.md D139): stake SOL of the connected main key in a new stake account, delegated to a validator, in
 * one transaction the main key signs and pays. Some wallets cannot stake on devnet; this page can. The next step is to
 * protect the new account, so the Done screen leads to /protect with it selected.
 */
export function StakePage({ signing, now = Date.now }: StakePageProps) {
  const { chain } = usePorts();
  const main = useSlot('main');
  const mainKey = main?.ready === true ? main.slot.address : null;
  const [page, setPage] = useState<PageState>({ kind: 'choose' });
  const [amount, setAmount] = useState('');
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const runKey = useRef(0);
  const checkOp = useRef(0);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const shown = useRef(page.kind);
  useEffect(() => {
    if (shown.current === page.kind) return;
    shown.current = page.kind;
    headingRef.current?.focus();
  }, [page.kind]);

  async function start(input: { mainKey: Address; lamports: bigint; voteAccount: Address | null; seed?: string }) {
    // A retry keeps the seed: if the first transaction landed late, the plan finds the account and reports it done
    // instead of staking twice. A new choice gets a new seed, so a new address.
    const seed = input.seed ?? newStakeAccountSeed(now());
    const stakeAccount = await deriveStakeAccountAddress(input.mainKey, seed);
    runKey.current += 1;
    setCheckFailed(false);
    setPage({ kind: 'sign', run: { ...input, seed, stakeAccount, key: runKey.current } });
  }

  function onFinished(run: Run, state: SigningState) {
    const job = state.jobs[run.stakeAccount];
    if (job === undefined) return;
    setPage({ kind: 'done', run, job });
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
      <PageHeader title={t('common.pages.stake')} lead={t('stake.intro')} meta={<p>{t('common.neverSeedPhrase')}</p>} />
      <div className="flex flex-col gap-6">
        {page.kind === 'choose' ? (
          mainKey === null ? (
            <div className="flex flex-col gap-3" data-slot="stake-connect">
              <p className="max-w-prose text-pretty">{t('stake.connect')}</p>
              <KeySlot role="main" connectLabel={t('app.connect.mainButton')} />
            </div>
          ) : (
            <StakeChoose
              key={mainKey}
              headingRef={headingRef}
              mainKey={mainKey}
              initialAmount={amount}
              onContinue={(input) => {
                setAmount(input.amount);
                void start({ mainKey, lamports: input.lamports, voteAccount: input.voteAccount });
              }}
            />
          )
        ) : null}
        {page.kind === 'sign' ? (
          <StakeSigning
            headingRef={headingRef}
            mainKey={page.run.mainKey}
            stakeAccount={page.run.stakeAccount}
            seed={page.run.seed}
            lamports={page.run.lamports}
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
          <StakeDone
            headingRef={headingRef}
            mainKey={page.run.mainKey}
            stakeAccount={page.run.stakeAccount}
            lamports={page.run.lamports}
            voteAccount={page.run.voteAccount}
            job={page.job}
            checking={checking}
            checkFailed={checkFailed}
            onRetry={() => {
              void start(page.run);
            }}
            onCheckAgain={() => void checkAgain(page.run, page.job)}
            onBack={back}
          />
        ) : null}
      </div>
    </Page>
  );
}
