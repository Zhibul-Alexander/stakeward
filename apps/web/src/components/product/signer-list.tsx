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

/**
 * Who signs, in order, and where each signature stands (UX rule 7: the wait is explained). Each key shows its role
 * and wallet, its full address (a signing screen never shortens addresses, DECISIONS.md D23), how many transactions
 * it approves and its status in a word, a colour and an icon. Presentational: the signing engine computes the items.
 */
export function SignerList({ items, className }: { items: readonly SignerListItem[]; className?: string | undefined }) {
  return (
    <ol aria-label={t('signing.signers')} data-slot="signer-list" className={cn('flex flex-col gap-3', className)}>
      {items.map((item, index) => {
        const { tone, icon: Icon, label } = LOOKS[item.status];
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
              <Badge tone={tone} data-status={item.status}>
                <Icon aria-hidden="true" />
                {t(label)}
              </Badge>
            </div>
            <AddressText address={item.address} variant="full" />
            <p className="text-sm text-muted">
              {item.count === 1
                ? t('components.signerList.approvesOne')
                : t('components.signerList.approvesOther', { count: item.count })}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/** Loading state: two signer cards while the transactions are built. Decorative; the panel announces the wait. */
export function SignerListSkeleton({ className }: { className?: string | undefined }) {
  return (
    <div aria-hidden="true" className={cn('flex flex-col gap-3', className)}>
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
