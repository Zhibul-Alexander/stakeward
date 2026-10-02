import { shortAddress, type Cluster } from '@stakeward/core';
import { cn } from 'cn';
import { CheckIcon, CopyIcon, ExternalLinkIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CLUSTER, explorerUrl } from '@/config';
import { t } from '@/i18n';

type CopyState = 'idle' | 'copied' | 'failed';

/** How long "Copied" / "Copy failed" stays before the button resets. */
const COPY_FEEDBACK_MS = 2000;

type AddressTextProps = {
  /** Base58 address, or a transaction signature with `kind="tx"`. */
  address: string;
  /**
   * `short` (default): `7xK...9fQ` with copy and explorer link (UX rule 9).
   * `full`: the whole address in monospace, wrapping on narrow screens; for signing screens, where a shortened
   * address could be forged (DECISIONS.md D23).
   */
  variant?: 'short' | 'full' | undefined;
  /** Explorer path: an account/wallet address or a transaction signature. */
  kind?: 'address' | 'tx' | undefined;
  /** Copy button; on by default. */
  copy?: boolean | undefined;
  /** Explorer link; on by default for `short`, off for `full`. */
  explorer?: boolean | undefined;
  cluster?: Cluster | undefined;
  className?: string | undefined;
};

/** An address the user can read, copy and open in Solana Explorer. Plain text only (never HTML from the network). */
export function AddressText({
  address,
  variant = 'short',
  kind = 'address',
  copy = true,
  explorer = variant === 'short',
  cluster = CLUSTER,
  className,
}: AddressTextProps) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const short = shortAddress(address);

  useEffect(() => {
    if (copyState === 'idle') return undefined;
    const timer = setTimeout(() => {
      setCopyState('idle');
    }, COPY_FEEDBACK_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [copyState]);

  async function copyAddress() {
    try {
      // navigator.clipboard is missing on insecure origins and in some embedded wallet browsers.
      if (!('clipboard' in navigator)) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(address);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  return (
    <span
      data-slot="address-text"
      data-variant={variant}
      className={cn(
        'inline-flex max-w-full gap-1',
        variant === 'full' ? 'w-full items-start' : 'items-center',
        className,
      )}
    >
      {variant === 'full' ? (
        <span className="min-w-0 flex-1 py-1.5 font-mono text-sm break-all">{address}</span>
      ) : (
        <span className="font-mono text-sm whitespace-nowrap" title={address}>
          {short}
        </span>
      )}
      {copy ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted hover:text-foreground"
          aria-label={t('common.copyAddress', { address: short })}
          onClick={() => {
            void copyAddress();
          }}
        >
          {copyState === 'copied' ? <CheckIcon aria-hidden="true" className="text-success" /> : <CopyIcon aria-hidden="true" />}
        </Button>
      ) : null}
      {explorer ? (
        <Button asChild variant="ghost" size="icon-sm" className="text-muted hover:text-foreground">
          <a
            href={explorerUrl(kind, address, cluster)}
            target="_blank"
            rel="noreferrer"
            aria-label={t('components.address.explorer', { address: short })}
          >
            <ExternalLinkIcon aria-hidden="true" />
          </a>
        </Button>
      ) : null}
      {copy ? (
        // Announces the result politely; the visible feedback is the check icon or the short failure text.
        <span role="status" className="sr-only">
          {copyState === 'copied'
            ? t('components.address.copied')
            : copyState === 'failed'
              ? t('components.address.copyFailed')
              : ''}
        </span>
      ) : null}
      {copyState === 'failed' ? (
        <span aria-hidden="true" className="self-center text-xs whitespace-nowrap text-danger">
          {t('components.address.copyFailedShort')}
        </span>
      ) : null}
    </span>
  );
}

/** Loading state: the footprint of a short address with its buttons. */
export function AddressTextSkeleton({ variant = 'short', className }: { variant?: 'short' | 'full' | undefined; className?: string | undefined }) {
  return <Skeleton className={cn('h-8', variant === 'full' ? 'w-full' : 'w-40', className)} />;
}
