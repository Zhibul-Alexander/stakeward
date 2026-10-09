import type { Address } from '@solana/kit';
import type { BuiltTransaction, ChainPort, WalletRole } from '@stakeward/core';
import { useState, type ReactNode } from 'react';
import { ErrorState } from '@/components/product/error-state';
import type { OnChainContext } from '@/components/product/transaction-summary';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useLoad } from '@/hooks/use-load';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import type { SigningRunResult } from './report.ts';
import { SigningRun, type ConfirmOptions, type Signer } from './SigningRun.tsx';
import { NonceNotReadyError } from './tasks.ts';

/** What a task builds before any wallet is asked. */
export type Prepared = {
  built: BuiltTransaction;
  signers: readonly Signer[];
  current?: OnChainContext | undefined;
  /** One line above the summary, e.g. who pays and why. */
  note?: string | undefined;
};

type TaskRunnerProps<P extends Prepared> = {
  chain: ChainPort;
  knownRoles: Partial<Record<WalletRole, Address>>;
  confirmOptions?: ConfirmOptions | undefined;
  /** Builds the transaction from fresh chain reads (called on mount and on "Try again"). */
  build: () => Promise<P>;
  /** After a run that reached a wallet: re-read the chain, record the result. What it returns is shown below. */
  onFinished: (result: SigningRunResult, prepared: P) => Promise<ReactNode>;
  /** Leaves the task: dropped before signing, or done and dismissed. */
  onClose: () => void;
  closeLabel: string;
};

type After = { status: 'running' } | { status: 'reading' } | { status: 'done'; node: ReactNode };

/** Build -> SigningRun -> what the page reads back afterwards. Keyed by the caller: one instance per attempt. */
export function TaskRunner<P extends Prepared>({ chain, knownRoles, confirmOptions, build, onFinished, onClose, closeLabel }: TaskRunnerProps<P>) {
  const [attempt, setAttempt] = useState(0);
  const prepared = useLoad(`build-${String(attempt)}`, build);
  const [after, setAfter] = useState<After>({ status: 'running' });

  switch (prepared.status) {
    case 'idle':
    case 'loading':
      return (
        <div role="status" className="flex flex-wrap items-center gap-3 text-sm">
          <Spinner className="size-5 text-muted" />
          <span>{t('devCosign.task.preparing')}</span>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      );
    case 'error':
      return (
        <ErrorState
          title={t('devCosign.task.prepareFailed')}
          message={prepared.raw instanceof NonceNotReadyError ? t('devCosign.nonce.notReady') : errorMessage(prepared.error)}
          detail={prepared.error.detail}
          onRetry={() => {
            setAttempt((value) => value + 1);
          }}
          actions={
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t('common.cancel')}
            </Button>
          }
        />
      );
    case 'ready':
      break;
  }
  const value = prepared.value;
  return (
    <div className="flex flex-col gap-4">
      {value.note === undefined ? null : <p className="text-sm font-medium">{value.note}</p>}
      <SigningRun
        chain={chain}
        built={value.built}
        signers={value.signers}
        current={value.current}
        knownRoles={knownRoles}
        confirmOptions={confirmOptions}
        onCancel={onClose}
        onFinished={(result) => {
          setAfter({ status: 'reading' });
          onFinished(result, value).then(
            (node) => {
              setAfter({ status: 'done', node });
            },
            () => {
              setAfter({ status: 'done', node: null });
            },
          );
        }}
      />
      {after.status === 'reading' ? (
        <div role="status" className="flex items-center gap-3 text-sm">
          <Spinner className="size-5 text-muted" />
          <span>{t('devCosign.task.reading')}</span>
        </div>
      ) : null}
      {after.status === 'done' ? (
        <>
          {after.node}
          <div>
            <Button variant="outline" onClick={onClose}>
              {closeLabel}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
