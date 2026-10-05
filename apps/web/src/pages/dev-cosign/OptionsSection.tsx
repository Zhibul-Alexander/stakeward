import { formatSol, type ChainPort } from '@stakeward/core';
import { useId, useState } from 'react';
import { AddressText } from '@/components/product/address-text';
import { ErrorState } from '@/components/product/error-state';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import type { Load } from '@/hooks/use-load';
import { t, type MessageKey } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import type { LifetimeChoice, SigningOrder } from './report.ts';
import type { ConfirmOptions, Signer } from './SigningRun.tsx';
import type { DevSlot } from './SlotsSection.tsx';
import { buildNonceClose, buildNonceSetup, type NonceInfo } from './tasks.ts';
import { TaskRunner } from './TaskRunner.tsx';

type OptionsSectionProps = {
  chain: ChainPort;
  confirmOptions?: ConfirmOptions | undefined;
  lifetime: LifetimeChoice;
  onLifetime: (value: LifetimeChoice) => void;
  order: SigningOrder;
  onOrder: (value: SigningOrder) => void;
  main: DevSlot | null;
  nonce: Load<NonceInfo>;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onRefresh: () => void;
};

/** Step 3: blockhash or durable nonce, which wallet signs first; the fee payer is always the main key (section 5). */
export function OptionsSection(props: OptionsSectionProps) {
  return (
    <div className="flex flex-col gap-6">
      <Choice
        legend={t('devCosign.options.lifetime')}
        value={props.lifetime}
        onChange={props.onLifetime}
        disabled={props.busy}
        options={[
          ['blockhash', 'devCosign.options.blockhash', 'devCosign.options.blockhashHint'],
          ['nonce', 'devCosign.options.nonce', 'devCosign.options.nonceHint'],
        ]}
      />
      {props.lifetime === 'nonce' ? <NoncePanel {...props} /> : null}
      <Choice
        legend={t('devCosign.options.order')}
        value={props.order}
        onChange={props.onOrder}
        disabled={props.busy}
        options={[
          ['main-first', 'devCosign.options.mainFirst', 'devCosign.options.mainFirstHint'],
          ['second-first', 'devCosign.options.secondFirst', 'devCosign.options.secondFirstHint'],
        ]}
      />
      <ul className="flex flex-col gap-1 text-sm">
        <li>{t('devCosign.options.feePayer')}</li>
        <li>{t('devCosign.options.lockPeriod')}</li>
      </ul>
    </div>
  );
}

function Choice<T extends string>({
  legend,
  value,
  onChange,
  options,
  disabled,
}: {
  legend: string;
  value: T;
  onChange: (value: T) => void;
  /** While a transaction is in progress: its panel must not disappear. */
  disabled: boolean;
  options: readonly (readonly [T, MessageKey, MessageKey])[];
}) {
  const id = useId();
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 font-semibold">{legend}</legend>
      <RadioGroup
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          const option = options.find(([candidate]) => candidate === next);
          if (option !== undefined) onChange(option[0]);
        }}
      >
        {options.map(([option, label, hint]) => (
          <div key={option} className="flex items-start gap-3">
            <RadioGroupItem value={option} id={`${id}-${option}`} aria-describedby={`${id}-${option}-hint`} className="mt-0.5" />
            <div className="flex flex-col gap-0.5">
              <Label htmlFor={`${id}-${option}`}>{t(label)}</Label>
              <span id={`${id}-${option}-hint`} className="text-sm text-muted">
                {t(hint)}
              </span>
            </div>
          </div>
        ))}
      </RadioGroup>
    </fieldset>
  );
}

type NonceTask = { id: number; kind: 'nonce-setup' | 'nonce-close'; main: Signer };

/** The main key's nonce account (core nonce-setup / nonce-close, signed by the main key alone). */
function NoncePanel({ chain, confirmOptions, main, nonce, busy, onBusy, onRefresh }: OptionsSectionProps) {
  const [task, setTask] = useState<NonceTask | null>(null);
  if (task !== null) {
    return (
      <TaskRunner
        key={task.id}
        chain={chain}
        knownRoles={{ main: task.main.address }}
        confirmOptions={confirmOptions}
        closeLabel={t('common.close')}
        build={async () => ({
          built: await (task.kind === 'nonce-setup' ? buildNonceSetup(chain, task.main.address) : buildNonceClose(chain, task.main.address)),
          signers: [task.main],
        })}
        onFinished={() => {
          onBusy(false);
          onRefresh();
          return Promise.resolve(null);
        }}
        onClose={() => {
          setTask(null);
          onBusy(false);
        }}
      />
    );
  }
  if (main === null) return <p className="text-sm text-muted">{t('devCosign.nonce.connectMain')}</p>;
  const startTask = (kind: NonceTask['kind']) => {
    setTask((previous) => ({ id: (previous?.id ?? 0) + 1, kind, main: { role: 'main', wallet: main.wallet, address: main.slot.address } }));
    onBusy(true);
  };
  switch (nonce.status) {
    case 'idle':
    case 'loading':
      return <Skeleton className="h-16 w-full" />;
    case 'error':
      return <ErrorState title={t('devCosign.nonce.loadFailed')} message={errorMessage(nonce.error)} detail={nonce.error.detail} onRetry={onRefresh} />;
    case 'ready':
      break;
  }
  const { address, state, deposit } = nonce.value;
  return (
    <div data-slot="nonce-panel" data-state={state.kind} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 text-sm">
      <div className="flex flex-wrap items-center gap-x-2">
        <span className="font-medium">{t('devCosign.nonce.account')}</span>
        <AddressText address={address} />
      </div>
      {state.kind === 'missing' ? (
        <>
          <p>{t('devCosign.nonce.missing', { deposit: formatSol(deposit) })}</p>
          <div>
            <Button
              disabled={busy}
              onClick={() => {
                startTask('nonce-setup');
              }}
            >
              {t('devCosign.nonce.create')}
            </Button>
          </div>
        </>
      ) : state.kind === 'ready' ? (
        <>
          <p>{t('devCosign.nonce.ready', { value: state.value })}</p>
          <div>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                startTask('nonce-close');
              }}
            >
              {t('devCosign.nonce.close', { amount: formatSol(state.lamports) })}
            </Button>
          </div>
        </>
      ) : (
        <p className="text-danger">{t(`devCosign.nonce.unusable.${state.reason}`)}</p>
      )}
    </div>
  );
}
