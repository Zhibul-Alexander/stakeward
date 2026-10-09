import type { Address } from '@solana/kit';
import type { WalletRole } from '@stakeward/core';
import { cn } from 'cn';
import {
  ArrowRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  LinkIcon,
  RepeatIcon,
  UnplugIcon,
  type LucideIcon,
} from 'lucide-react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { t, type MessageKey } from '@/i18n';
import { AddressText } from './address-text.tsx';
import { roleLabel } from './wallet-slot.tsx';

/** `link`: this key signs on another device through the signing link, never in this browser. */
export type SignerStatus = 'waiting' | 'current' | 'signed' | 'switch' | 'stopped' | 'missing' | 'link';

/** One signature the round still needs or already has, in signing order (core `signingOrder`). */
export type SignerListItem = {
  role: WalletRole;
  /** The wallet app that holds this key in this browser; null when no connected wallet offers it. */
  walletName: string | null;
  address: Address;
  /** Transactions this key approves in its one wallet request. */
  count: number;
  status: SignerStatus;
};

type Look = { tone: NonNullable<BadgeProps['tone']>; icon: LucideIcon; label: MessageKey };

/** Word + colour + icon for each status (UX rule 5): colour is never the only signal. */
const LOOKS: Record<SignerStatus, Look> = {
  waiting: { tone: 'outline', icon: CircleDashedIcon, label: 'components.signerList.status.waiting' },
  current: { tone: 'info', icon: ArrowRightIcon, label: 'components.signerList.status.current' },
  signed: { tone: 'success', icon: CircleCheckIcon, label: 'components.signerList.status.signed' },
  switch: { tone: 'warning', icon: RepeatIcon, label: 'components.signerList.status.switch' },
  stopped: { tone: 'danger', icon: CircleXIcon, label: 'components.signerList.status.stopped' },
  missing: { tone: 'neutral', icon: UnplugIcon, label: 'components.signerList.status.missing' },
  link: { tone: 'info', icon: LinkIcon, label: 'components.signerList.status.link' },
};

type SignerListProps = {
  items: readonly SignerListItem[];
  /**
   * `full` (default): a card per key with its full address. `compact`: one line per key, its number, role, wallet and
   * status, and how many transactions each approves said once when it is the same for all; no address. The signing
   * screen uses compact above its summary, whose "Who signs" holds the full addresses read from the bytes (DECISIONS.md
   * D109).
   */
  variant?: 'full' | 'compact' | undefined;
  className?: string | undefined;
};

/**
 * Who signs, in order, and where each signature stands (UX rule 7: the wait is explained). Each key shows its role
 * and wallet, how many transactions it approves and its status in a word, a colour and an icon. `full` also shows its
 * full address (a signing screen never shortens addresses, DECISIONS.md D23); `compact` leaves the address to the
 * summary under it. Presentational: the signing engine computes the items.
 */
export function SignerList({ items, variant = 'full', className }: SignerListProps) {
  if (variant === 'compact') return <CompactSignerList items={items} className={className} />;
  return (
    <ol aria-label={t('signing.signers')} data-slot="signer-list" data-variant="full" className={cn('flex flex-col gap-3', className)}>
      {items.map((item, index) => {
        const n = index + 1;
        const role = roleLabel(item.role);
        return (
          <li
            key={`${String(index)}-${item.address}`}
            aria-current={item.status === 'current' ? 'step' : undefined}
            data-status={item.status}
            data-role={item.role}
            className={cn(
              'flex flex-col gap-2 rounded-md border bg-surface p-3',
              item.status === 'current' ? 'border-primary' : item.status === 'stopped' ? 'border-danger-border' : 'border-border',
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">
                {item.walletName === null
                  ? t('components.signerList.notConnected', { n, role })
                  : t('components.signerList.title', { n, role, wallet: item.walletName })}
              </span>
              <StatusBadge status={item.status} />
            </div>
            <AddressText address={item.address} variant="full" />
            <p className="text-sm text-muted">{approves(item.count)}</p>
          </li>
        );
      })}
    </ol>
  );
}

function approves(count: number): string {
  return count === 1 ? t('components.signerList.approvesOne') : t('components.signerList.approvesOther', { count });
}

function StatusBadge({ status }: { status: SignerStatus }) {
  const { tone, icon: Icon, label } = LOOKS[status];
  return (
    <Badge tone={tone} data-status={status}>
      <Icon aria-hidden="true" />
      {t(label)}
    </Badge>
  );
}

/** The compact order: "1 · Main key · Wallet A · Your turn", one line per key, the count once when all share it. */
function CompactSignerList({ items, className }: { items: readonly SignerListItem[]; className?: string | undefined }) {
  const [first] = items;
  const sameCount = first !== undefined && items.every((item) => item.count === first.count);
  return (
    <div data-slot="signer-list" data-variant="compact" className={cn('flex flex-col gap-2', className)}>
      <ol aria-label={t('signing.signers')} className="flex flex-col gap-2">
        {items.map((item, index) => {
          const current = item.status === 'current';
          return (
            <li
              key={`${String(index)}-${item.address}`}
              aria-current={current ? 'step' : undefined}
              data-status={item.status}
              data-role={item.role}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                  current ? 'bg-primary-soft text-primary ring-2 ring-primary' : 'bg-subtle text-muted',
                )}
              >
                {index + 1}
              </span>
              <span className="font-semibold">{roleLabel(item.role)}</span>
              {item.walletName === null ? null : (
                <>
                  <span aria-hidden="true" className="text-muted">
                    ·
                  </span>
                  <span className="min-w-0 truncate text-muted">{item.walletName}</span>
                </>
              )}
              <StatusBadge status={item.status} />
              {sameCount ? null : <span className="w-full pl-8 text-muted">{approves(item.count)}</span>}
            </li>
          );
        })}
      </ol>
      {sameCount ? <p className="text-sm text-muted">{approves(first.count)}</p> : null}
    </div>
  );
}

/**
 * Loading state while the transactions are built: two signer cards (`full`) or two lines (`compact`). Decorative; the
 * panel announces the wait.
 */
export function SignerListSkeleton({ variant = 'full', className }: { variant?: 'full' | 'compact' | undefined; className?: string | undefined }) {
  if (variant === 'compact') {
    return (
      <div aria-hidden="true" data-slot="signer-list-skeleton" className={cn('flex flex-col gap-2', className)}>
        {[0, 1].map((key) => (
          <div key={key} className="flex items-center gap-2">
            <Skeleton className="size-6 rounded-full" />
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div aria-hidden="true" data-slot="signer-list-skeleton" className={cn('flex flex-col gap-3', className)}>
      {[0, 1].map((key) => (
        <div key={key} className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-4 w-40" />
        </div>
      ))}
    </div>
  );
}
