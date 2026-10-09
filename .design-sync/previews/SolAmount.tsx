import { SolAmount } from '@stakeward/design-system';
import { formatSol, networkFeeFor } from '@stakeward/core';
import type { ReactNode } from 'react';

/** A row's amount: semibold, a step larger than the text around it. */
export const RowAmount = () => <SolAmount lamports={1_250_500_000_000n} className="text-lg font-semibold" />;

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
 * The landing's fees table: each fee from core networkFeeFor (5000 lamports per signature plus the fixed priority
 * fee), every decimal that matters; the link-signing deposit as read from the network.
 */
export const FeesTable = () => (
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
    <FeeRow label="Link-signing deposit" amount={<SolAmount lamports={1_447_680n} />} payer="Comes back when you close the account." />
  </dl>
);

function Stat({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col-reverse justify-end gap-1 rounded-lg border border-border bg-surface p-4 sm:p-5">
      <dt className="text-sm text-muted">{term}</dt>
      <dd className="text-2xl tabular-nums wrap-anywhere">{children}</dd>
    </div>
  );
}

/** /stats: the SOL under watched locks in whole SOL, rounded down, in a tile that wraps rather than overflows. */
export const StatTile = () => (
  <dl className="grid gap-3 sm:grid-cols-3 sm:gap-4">
    <Stat term="Locked stake accounts Stakeward watches">128</Stat>
    <Stat term="SOL in those stake accounts">
      <SolAmount lamports={18_450_000_000_000n} className="whitespace-normal" />
    </Stat>
    <Stat term="Telegram alerts sent">37</Stat>
  </dl>
);
