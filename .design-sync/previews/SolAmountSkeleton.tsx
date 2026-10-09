import { SolAmount, SolAmountSkeleton } from '@stakeward/design-system';
import { formatSol, networkFeeFor } from '@stakeward/core';
import type { ReactNode } from 'react';

/** An amount loading: the footprint of a few digits and "SOL". */
export const Default = () => <SolAmountSkeleton />;

function FeeRow({ label, amount, payer }: { label: string; amount: ReactNode; payer: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 px-4 py-2 sm:flex-nowrap sm:py-2.5">
      <dt className="min-w-0 flex-1 text-sm font-medium sm:w-52 sm:flex-none">{label}</dt>
      <dd className="text-sm font-medium tabular-nums sm:order-last">{amount}</dd>
      <dd className="w-full text-sm text-pretty text-muted sm:w-auto sm:min-w-0 sm:flex-1">{payer}</dd>
    </div>
  );
}

/**
 * The landing's fees table while the link-signing deposit is read from the network: that one amount is a skeleton
 * (with "Loading" for screen readers); the fees, computed in the page, are already there.
 */
export const DepositLoading = () => (
  <dl className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
    <FeeRow label="Protect a stake account" amount={<SolAmount lamports={networkFeeFor(2)} />} payer="Paid by your main key." />
    <FeeRow
      label="Extend or remove a lock"
      amount={<SolAmount lamports={networkFeeFor(1)} />}
      payer={`Paid by your second key. If it has no SOL, your main key pays ${formatSol(networkFeeFor(2))}.`}
    />
    <FeeRow
      label="Withdraw"
      amount={<SolAmount lamports={networkFeeFor(2)} />}
      payer={`Paid by your main key, plus ${formatSol(networkFeeFor(1))} if the stake must stop staking first.`}
    />
    <FeeRow label="Rescue a stake account" amount={<SolAmount lamports={networkFeeFor(3)} />} payer="Paid by your new wallet." />
    <FeeRow
      label="Link-signing deposit"
      amount={
        <>
          <SolAmountSkeleton />
          <span className="sr-only">Loading</span>
        </>
      }
      payer="Comes back when you close the account."
    />
  </dl>
);
