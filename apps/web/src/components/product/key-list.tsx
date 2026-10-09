import type { WalletRole } from '@stakeward/core';
import { cn } from 'cn';
import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { AddressText } from './address-text.tsx';
import { roleLabel } from './wallet-slot.tsx';

export type KeyListItem = {
  role: WalletRole;
  /** The key's address, shown in full with copy and explorer (UX rule 9, DECISIONS.md D23). */
  address: string;
  /** What this key does here, in one line ("Receives the SOL and pays the network fee"). */
  note?: ReactNode;
};

type KeyListProps = {
  items: readonly KeyListItem[];
  className?: string | undefined;
};

/**
 * The keys an action needs, before anything is signed (DECISIONS.md D112): per row the role (Main key, Second key, New
 * wallet), its whole address with copy and explorer, and one line of what it does here. A <dl> in one panel with
 * hairlines between the rows; from 640 px the role stands left of the address.
 */
export function KeyList({ items, className }: KeyListProps) {
  return (
    <dl data-slot="key-list" className={cn('divide-y divide-border rounded-lg border border-border bg-surface', className)}>
      {items.map((item) => (
        <div
          key={`${item.role}-${item.address}`}
          data-role={item.role}
          className="flex flex-col px-4 py-2.5 sm:flex-row sm:gap-x-4 sm:py-3"
        >
          <dt className="text-sm font-semibold sm:w-28 sm:shrink-0 sm:pt-1.5">{roleLabel(item.role)}</dt>
          <dd className="flex min-w-0 flex-1 flex-col">
            <AddressText address={item.address} variant="full" explorer />
            {item.note === undefined ? null : <div className="flex flex-col gap-0.5 text-sm text-muted">{item.note}</div>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Loading state of a KeyList: its panel with `rows` rows of the same shape. Decorative. */
export function KeyListSkeleton({ rows = 2, className }: { rows?: number | undefined; className?: string | undefined }) {
  return (
    <div aria-hidden="true" data-slot="key-list-skeleton" className={cn('divide-y divide-border rounded-lg border border-border bg-surface', className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:gap-x-4">
          <Skeleton className="h-5 w-20 sm:w-28 sm:shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-5 w-full max-w-sm" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
      ))}
    </div>
  );
}
