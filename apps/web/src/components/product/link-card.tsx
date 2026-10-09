import type { Address, Signature } from '@solana/kit';
import type { WalletRole } from '@stakeward/core';
import { cn } from 'cn';
import { ChevronDownIcon, CopyIcon, PauseIcon, WifiOffIcon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { t } from '@/i18n';
import { AddressText } from './address-text.tsx';
import { QrCode } from './qr-code.tsx';
import { roleLabel } from './wallet-slot.tsx';

type CopyState = 'idle' | 'copied' | 'failed';

export type LinkCardProps = {
  /** The /cosign link (the partly signed transaction in its fragment). */
  url: string;
  /** The transaction id (the fee payer's signature): the explorer shows it once the other device sends it. */
  signature: Signature | null;
  /** The keys that sign through the link, in signing order; shown in full (DECISIONS.md D23). */
  signers: readonly { role: WalletRole; address: Address }[];
  /** This page is checking the network for the outcome; false once the watch paused. */
  watching: boolean;
  /** The latest check could not reach the network (it keeps trying). */
  lastCheckFailed: boolean;
  /** Stop waiting on this page (the link keeps working). Without it the card shows no Stop button. */
  onStopWaiting?: (() => void) | undefined;
  /** A new watch after the pause. Without it the paused card offers no Check again. */
  onCheckAgain?: (() => void) | undefined;
  /**
   * The page's way to cancel the link (closing the link-signing account), shown inline under "Cancel the link". It
   * stays mounted while folded (only hidden), so folding it never drops a close that is being signed.
   */
  cancel?: ReactNode;
  className?: string | undefined;
};

/** "Main key and Second key" (English list format; en.json is the only language for now). */
export function joinRoles(roles: readonly WalletRole[]): string {
  return new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(roles.map(roleLabel));
}

/** Where the wait stands, as a badge: watching (with a spinner), the network unreachable, or stopped. */
function LinkStatus({ watching, lastCheckFailed }: { watching: boolean; lastCheckFailed: boolean }) {
  if (!watching) {
    return (
      <Badge tone="outline" size="md">
        <PauseIcon aria-hidden="true" />
        {t('signing.link.statusPaused')}
      </Badge>
    );
  }
  if (lastCheckFailed) {
    return (
      <Badge tone="warning" size="md">
        <WifiOffIcon aria-hidden="true" />
        {t('signing.link.statusOffline')}
      </Badge>
    );
  }
  return (
    <Badge tone="info" size="md">
      <Spinner aria-hidden="true" />
      {t('signing.link.statusWaiting')}
    </Badge>
  );
}

/**
 * Signing by link, on the first device (CLAUDE.md section 6): whom to send the link to, with that key's address in
 * full, the link as a QR code for the other device's camera and as text with Copy (the screen's one filled button), the
 * transaction id, and whether this page is still waiting (UX rule 7: the wait is explained; Stop waiting and Cancel are
 * the ways out). Cancel opens inline, with the deposit stated before anything is signed. Presentational: the signing
 * panel computes the props (`linkView`).
 */
export function LinkCard({
  url,
  signature,
  signers,
  watching,
  lastCheckFailed,
  onStopWaiting,
  onCheckAgain,
  cancel,
  className,
}: LinkCardProps) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [cancelOpen, setCancelOpen] = useState(false);
  const urlId = useId();
  const titleId = useId();
  const cancelId = useId();
  const roles = joinRoles(signers.map((signer) => signer.role));
  const [only] = signers;

  async function copyLink() {
    try {
      // navigator.clipboard is missing on insecure origins and in some embedded wallet browsers.
      if (!('clipboard' in navigator)) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  return (
    <section
      aria-labelledby={titleId}
      data-slot="link-card"
      className={cn('flex flex-col gap-5 rounded-lg border border-border bg-surface p-4 sm:p-6', className)}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <h3 id={titleId} className="text-lg font-semibold text-balance">
            {signers.length === 1 && only !== undefined
              ? t('signing.link.title', { role: roleLabel(only.role) })
              : t('signing.link.titleMany', { roles })}
          </h3>
          <div role="status" data-slot="link-status">
            <LinkStatus watching={watching} lastCheckFailed={lastCheckFailed} />
          </div>
        </div>
        <dl className="flex flex-col gap-2">
          {signers.map((signer) => (
            <div key={`${signer.role}-${signer.address}`} className="flex flex-col">
              <dt className="text-sm font-medium">{roleLabel(signer.role)}</dt>
              <dd>
                <AddressText address={signer.address} variant="full" />
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <QrCode value={url} label={t('signing.link.qrLabel')} className="size-60 max-w-full shrink-0 self-center sm:self-start" />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-col gap-1 text-sm">
            <p>{t('signing.link.body', { role: roles })}</p>
            <p className="text-muted">{t('signing.link.scan')}</p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={urlId}>{t('signing.link.url')}</Label>
            <Input
              id={urlId}
              readOnly
              value={url}
              onFocus={(event) => {
                event.currentTarget.select();
              }}
              className="min-w-0 font-mono"
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Button
                type="button"
                onClick={() => {
                  void copyLink();
                }}
                className="w-full sm:w-fit"
              >
                <CopyIcon aria-hidden="true" />
                {t('signing.link.copy')}
              </Button>
              <p aria-live="polite" className={cn('text-sm', copyState === 'failed' ? 'text-danger' : 'text-muted')}>
                {copyState === 'copied' ? t('signing.link.copied') : copyState === 'failed' ? t('signing.link.copyFailed') : ''}
              </p>
            </div>
          </div>
          {signature === null ? null : (
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{t('signing.link.txId')}</span>
              <AddressText address={signature} kind="tx" />
            </div>
          )}
        </div>
      </div>

      {watching ? (
        <p className="text-sm text-muted">{t('signing.link.waiting')}</p>
      ) : (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm">{t('signing.link.paused')}</p>
          {onCheckAgain === undefined ? null : (
            <Button variant="outline" onClick={onCheckAgain}>
              {t('signing.link.checkAgain')}
            </Button>
          )}
        </div>
      )}

      {onStopWaiting === undefined && cancel === undefined ? (
        <p className="text-sm text-muted">{t('signing.link.stopNote')}</p>
      ) : (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          {/* The note belongs to Stop waiting; Cancel's inset comes right under the button that opens it. */}
          <p className="text-sm text-muted">{t('signing.link.stopNote')}</p>
          <div className="flex flex-wrap items-center gap-2">
            {onStopWaiting === undefined ? null : (
              // -ml-4 takes back the ghost button's own padding, so its label starts on the card's text column.
              <Button variant="ghost" onClick={onStopWaiting} className="-ml-4 h-auto min-h-10 max-w-full whitespace-normal">
                {t('signing.link.stopWaiting')}
              </Button>
            )}
            {cancel === undefined ? null : (
              <Button
                variant="outline"
                aria-expanded={cancelOpen}
                aria-controls={cancelId}
                onClick={() => {
                  setCancelOpen((open) => !open);
                }}
                className="sm:ml-auto"
              >
                {t('signing.link.cancel')}
                <ChevronDownIcon aria-hidden="true" className={cn('transition-transform', cancelOpen ? 'rotate-180' : undefined)} />
              </Button>
            )}
          </div>
          {cancel === undefined ? null : (
            // A disclosure, not a Radix Collapsible: that one unmounts its content when closed, which would drop the
            // page's close (and its signing session) when folded mid-sign.
            <div id={cancelId} hidden={!cancelOpen} className="rounded-md bg-subtle p-4 empty:hidden">
              {cancel}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
