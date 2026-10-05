import { shortAddress, type Cluster } from '@stakeward/core';
import { cn } from 'cn';
import { CheckIcon, CopyIcon, ExternalLinkIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CLUSTER, explorerUrl } from '@/config';
import { t } from '@/i18n';
import { useCopy } from './use-copy.ts';

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
  const { state: copyState, copy: copyText } = useCopy();
  const short = shortAddress(address);

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
          className="text-muted hover:text-foreground print:hidden"
          aria-label={t('common.copyAddress', { address: short })}
          onClick={() => {
            void copyText(address);
          }}
        >
          {copyState === 'copied' ? <CheckIcon aria-hidden="true" className="text-success" /> : <CopyIcon aria-hidden="true" />}
        </Button>
      ) : null}
      {explorer ? (
        <Button asChild variant="ghost" size="icon-sm" className="text-muted hover:text-foreground print:hidden">
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
        <span aria-hidden="true" className="self-center text-xs whitespace-nowrap text-danger print:hidden">
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
