import type { Address } from '@solana/kit';
import type { WalletRole } from '@stakeward/core';
import { cn } from 'cn';
import {
  ChevronDownIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
  WalletIcon,
  type LucideIcon,
} from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { t, type MessageKey } from '@/i18n';
import { AddressText } from './address-text.tsx';
import { ErrorState } from './error-state.tsx';

/** A wallet the user can pick (Wallet Standard: name and data: URI icon; `id` is the WalletPort id). */
export type WalletOption = { id: string; name: string; icon: string };

export type WalletSlotStatus = WalletSlotProps['status'];

type Common = {
  role: WalletRole;
  /** One line under the role name, e.g. what this key signs here. */
  description?: string | undefined;
  className?: string | undefined;
};

export type WalletSlotProps = Common &
  (
    | { status: 'loading' }
    | {
        status: 'empty';
        /** Wallets found in this browser; an empty list explains how to get one. */
        wallets: readonly WalletOption[];
        onConnect: (walletId: string) => void;
        /** Show the wallet list without a click (e.g. right after "Continue"). */
        defaultPickerOpen?: boolean | undefined;
      }
    | { status: 'connecting'; wallet: WalletOption; onCancel: () => void }
    | { status: 'connected'; wallet: WalletOption; address: string; onDisconnect: () => void }
    | {
        status: 'error';
        wallet: WalletOption;
        /** What happened and what to do next (e.g. from errorMessage(translateError(e))). */
        message: string;
        detail?: string | undefined;
        onRetry: () => void;
        /** Back to the wallet list. */
        onCancel: () => void;
      }
    | {
        /**
         * The wallet gave an account that cannot fill this role (for example the same account as the main key, when
         * the wallet exposes one account at a time). The user switches accounts in the wallet and presses Continue.
         */
        status: 'wrong-account';
        wallet: WalletOption;
        address: string;
        /** The role this account already fills, when that is the problem. */
        conflictRole?: WalletRole | undefined;
        /** The account this step needs, shown in full instead of the generic "switch" line. */
        expected?: Address | undefined;
        /** Continue after switching; without it only Disconnect is offered (a filled slot is never swapped). */
        onContinue?: (() => void) | undefined;
        onDisconnect: () => void;
      }
  );

const ROLE_LABEL: Record<WalletRole, MessageKey> = {
  main: 'common.roles.main',
  second: 'common.roles.second',
  new: 'common.roles.new',
};

export function roleLabel(role: WalletRole): string {
  return t(ROLE_LABEL[role]);
}

type Chip = { tone: NonNullable<BadgeProps['tone']>; icon: LucideIcon; label: MessageKey };

const CHIPS: Record<Exclude<WalletSlotStatus, 'loading'>, Chip> = {
  empty: { tone: 'outline', icon: CircleDashedIcon, label: 'components.walletSlot.notConnected' },
  connecting: { tone: 'info', icon: LoaderCircleIcon, label: 'components.walletSlot.connecting' },
  connected: { tone: 'success', icon: CircleCheckIcon, label: 'components.walletSlot.connected' },
  error: { tone: 'danger', icon: CircleXIcon, label: 'components.walletSlot.failed' },
  'wrong-account': { tone: 'warning', icon: TriangleAlertIcon, label: 'components.walletSlot.checkAccount' },
};

/**
 * One key role (Main key, Second key, New wallet) and the wallet account filling it (CLAUDE.md section 6: three slots
 * by role). States: loading (restoring slots), empty (wallet list), connecting (with a way out), connected
 * (icon, name, short address, disconnect), error (what happened, details, try again) and wrong-account (switch the
 * account in the wallet, then Continue; with `expected`, the account the step needs in full, and Continue only when
 * the page offers it). Presentational: the page owns the WalletPort and passes callbacks.
 */
export function WalletSlot(props: WalletSlotProps) {
  const labelId = useId();
  const role = roleLabel(props.role);
  const chip = props.status === 'loading' ? null : CHIPS[props.status];
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      data-slot="wallet-slot"
      data-status={props.status}
      className={cn('flex flex-col gap-3 rounded-lg border border-border bg-surface p-4', props.className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={labelId} className="font-semibold">
          {role}
        </span>
        {chip === null ? (
          <Skeleton className="h-6 w-24 rounded-full" />
        ) : (
          <Badge tone={chip.tone}>
            <chip.icon aria-hidden="true" />
            {t(chip.label)}
          </Badge>
        )}
      </div>
      {props.description === undefined ? null : <p className="text-sm text-muted">{props.description}</p>}
      <SlotBody {...props} roleText={role} />
    </div>
  );
}

function SlotBody(props: WalletSlotProps & { roleText: string }): ReactNode {
  switch (props.status) {
    case 'loading':
      return (
        <div className="flex items-center gap-3">
          <Skeleton className="size-8" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-36" />
          </div>
        </div>
      );
    case 'empty':
      return (
        <WalletPicker
          wallets={props.wallets}
          onConnect={props.onConnect}
          defaultOpen={props.defaultPickerOpen ?? false}
          roleText={props.roleText}
        />
      );
    case 'connecting':
      return (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 text-sm">
            <Spinner className="size-5 text-muted" />
            <span>{t('components.walletSlot.approve', { wallet: props.wallet.name })}</span>
          </div>
          <div>
            <Button variant="outline" size="sm" onClick={props.onCancel}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      );
    case 'connected':
      return (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <WalletIdentity wallet={props.wallet} address={props.address} />
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('components.walletSlot.disconnectLabel', { wallet: props.wallet.name, role: props.roleText })}
            onClick={props.onDisconnect}
          >
            {t('components.walletSlot.disconnect')}
          </Button>
        </div>
      );
    case 'error':
      return (
        <ErrorState
          title={t('components.walletSlot.errorTitle', { wallet: props.wallet.name })}
          message={props.message}
          detail={props.detail}
          onRetry={props.onRetry}
          actions={
            <Button variant="ghost" size="sm" onClick={props.onCancel}>
              {t('components.walletSlot.chooseAnother')}
            </Button>
          }
        />
      );
    case 'wrong-account':
      return (
        <div className="flex flex-col gap-3">
          <WalletIdentity wallet={props.wallet} address={props.address} />
          <Alert tone="warning" role="note">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertDescription className="flex flex-col gap-1 text-foreground">
              {props.conflictRole === undefined ? null : (
                <p>{t('components.walletSlot.conflict', { role: roleLabel(props.conflictRole) })}</p>
              )}
              {props.expected === undefined ? (
                <p className="font-medium">{t(`components.walletSlot.switch.${props.role}`)}</p>
              ) : (
                <>
                  <p className="font-medium">{t('components.walletSlot.expected')}</p>
                  <AddressText address={props.expected} variant="full" />
                </>
              )}
            </AlertDescription>
          </Alert>
          <div className="flex flex-wrap gap-2">
            {props.onContinue === undefined ? null : (
              <Button size="sm" onClick={props.onContinue}>
                {t('common.continue')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('components.walletSlot.disconnectLabel', { wallet: props.wallet.name, role: props.roleText })}
              onClick={props.onDisconnect}
            >
              {t('components.walletSlot.disconnect')}
            </Button>
          </div>
        </div>
      );
  }
}

function WalletIdentity({ wallet, address }: { wallet: WalletOption; address: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {/* Wallet Standard icons are data: URIs; the CSP allows img-src data:. The name next to it is the text. */}
      <img src={wallet.icon} alt="" className="size-8 shrink-0 rounded-md" />
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{wallet.name}</span>
        <AddressText address={address} />
      </div>
    </div>
  );
}

function WalletPicker({
  wallets,
  onConnect,
  defaultOpen,
  roleText,
}: {
  wallets: readonly WalletOption[];
  onConnect: (walletId: string) => void;
  defaultOpen: boolean;
  roleText: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const listId = useId();
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button
          aria-expanded={open}
          aria-controls={listId}
          aria-label={t('components.walletSlot.connectAs', { role: roleText })}
          onClick={() => {
            setOpen((value) => !value);
          }}
        >
          <WalletIcon aria-hidden="true" />
          {t('components.walletSlot.connect')}
          <ChevronDownIcon aria-hidden="true" className={cn('transition-transform', open && 'rotate-180')} />
        </Button>
      </div>
      <div id={listId} hidden={!open}>
        {wallets.length === 0 ? (
          <p className="text-sm text-muted">{t('components.walletSlot.noWallets')}</p>
        ) : (
          <ul aria-label={t('components.walletSlot.chooseWallet')} className="flex flex-col gap-2">
            {wallets.map((wallet) => (
              <li key={wallet.id}>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => {
                    onConnect(wallet.id);
                  }}
                >
                  <img src={wallet.icon} alt="" className="size-5 rounded-sm" />
                  {wallet.name}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
