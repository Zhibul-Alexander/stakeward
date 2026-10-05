import type { Address, Signature } from '@solana/kit';
import type { WalletRole } from '@stakeward/core';
import { cn } from 'cn';
import { CopyIcon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
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
  /** The page's way to cancel the link (closing the link-signing account). */
  cancel?: ReactNode;
  className?: string | undefined;
};

/**
 * Signing by link, on the first device (CLAUDE.md section 6): whom to send the link to, what it holds (partial
 * signatures, never a key), the link as a QR code for the other device's camera and as text with Copy, the
 * transaction id, and whether this page is still waiting for the other device (UX rule 7: the wait is explained, and
 * Stop waiting and Cancel are the ways out). Presentational: the signing panel computes the props (`linkView`).
 */
export function LinkCard({ url, signature, signers, watching, lastCheckFailed, cancel, className }: LinkCardProps) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const urlId = useId();
  const roles = signers.map((signer) => roleLabel(signer.role));
  const [only] = roles;

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
    <section data-slot="link-card" className={cn('flex flex-col gap-4 rounded-md border border-border bg-surface p-4', className)}>
      <h3 className="text-base font-semibold">
        {roles.length === 1 && only !== undefined
          ? t('signing.link.title', { role: only })
          : t('signing.link.titleMany', { roles: joinRoles(roles) })}
      </h3>
      <ul className="flex flex-col gap-2">
        {signers.map((signer) => (
          <li key={`${signer.role}-${signer.address}`} className="flex flex-col gap-1">
            <span className="text-sm font-medium">{roleLabel(signer.role)}</span>
            <AddressText address={signer.address} variant="full" />
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2 text-sm">
        <p>{t('signing.link.body')}</p>
        <p>{t('signing.link.scan')}</p>
      </div>
      <QrCode value={url} label={t('signing.link.qrLabel')} className="self-center" />
      <div className="flex flex-col gap-2">
        <Label htmlFor={urlId}>{t('signing.link.url')}</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id={urlId}
            readOnly
            value={url}
            onFocus={(event) => {
              event.currentTarget.select();
            }}
            className="min-w-0 flex-1 font-mono"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void copyLink();
            }}
          >
            <CopyIcon aria-hidden="true" />
            {t('signing.link.copy')}
          </Button>
        </div>
        <p aria-live="polite" className={cn('text-sm', copyState === 'failed' ? 'text-danger' : 'text-muted')}>
          {copyState === 'copied' ? t('signing.link.copied') : copyState === 'failed' ? t('signing.link.copyFailed') : ''}
        </p>
      </div>
      {signature === null ? null : (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t('signing.link.txId')}</span>
          <AddressText address={signature} kind="tx" />
        </div>
      )}
      <div role="status" className="flex flex-col gap-1 text-sm">
        {watching ? (
          <>
            <span className="flex items-center gap-3">
              <Spinner className="size-5 shrink-0 text-muted" />
              <span className="min-w-0">{t('signing.link.waiting')}</span>
            </span>
            {lastCheckFailed ? <span className="text-warning">{t('signing.link.checkFailed')}</span> : null}
          </>
        ) : (
          <span>{t('signing.link.paused')}</span>
        )}
      </div>
      <p className="text-sm text-muted">{t('signing.link.stopNote')}</p>
      {cancel}
    </section>
  );
}

/** "Main key and Second key" (English list format; en.json is the only language for now). */
function joinRoles(roles: readonly string[]): string {
  return new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(roles);
}
