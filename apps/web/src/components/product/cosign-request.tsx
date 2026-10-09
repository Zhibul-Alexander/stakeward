import type { Address } from '@solana/kit';
import type { WalletRole } from '@stakeward/core';
import { cn } from 'cn';
import { CircleCheckIcon, TriangleAlertIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { t } from '@/i18n';
import { AddressText } from './address-text.tsx';
import { roleLabel } from './wallet-slot.tsx';

/** The check before signing a withdrawal or a rescue: whom it may come from, and the one address to check. */
export type CosignCheck = {
  title: string;
  lines: readonly string[];
  /** The role of the address to check ("Main key", "New wallet") and the address, in full. */
  role: WalletRole;
  address: Address;
};

type CosignRequestProps = {
  /** The link's transaction kind (`data-kind`): protect, withdraw or rescue. */
  kind: string;
  /** Who sent it: the role of the fee payer, who signed before the link was made. */
  from: WalletRole;
  /** The h2, the ask in one line: "Become the Second key for this stake until 3 April 2027". */
  ask: string;
  /** One to three short lines under the ask. */
  lines?: readonly string[] | undefined;
  /** One muted line, e.g. how much the stake account holds once it is read. */
  meta?: ReactNode;
  /** The check before signing, a warning callout with the address in full. */
  check?: CosignCheck | undefined;
  className?: string | undefined;
};

/**
 * What a /cosign link asks of this wallet, before anything else (UX rule 6): who sent it and that they signed, the ask
 * as the heading with a line or three, and for a withdrawal or a rescue the one address to check. The kind of
 * transaction is the summary's title right below, so it is not repeated here. An inset without a frame: the danger
 * frame is kept for "Do not sign" (StopPanel).
 */
export function CosignRequest({ kind, from, ask, lines = [], meta, check, className }: CosignRequestProps) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      data-slot="cosign-ask"
      data-kind={kind}
      className={cn('flex flex-col gap-3 rounded-lg bg-subtle p-4 sm:p-5', className)}
    >
      <div className="flex flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{t('cosign.from', { role: roleLabel(from) })}</span>
          <Badge tone="success">
            <CircleCheckIcon aria-hidden="true" />
            {t('components.tx.signed')}
          </Badge>
        </p>
        <h2 id={titleId} className="text-lg font-semibold text-pretty">
          {ask}
        </h2>
      </div>
      {lines.length === 0 && meta === undefined ? null : (
        <div className="flex flex-col gap-1">
          {lines.map((line) => (
            <p key={line} className="text-base text-pretty">
              {line}
            </p>
          ))}
          {meta === undefined ? null : <p className="text-sm text-muted tabular-nums">{meta}</p>}
        </div>
      )}
      {check === undefined ? null : (
        <Alert tone="warning" role="note" data-slot="cosign-check" className="px-3 sm:px-4">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>{check.title}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2 text-foreground [&_p:not(:last-child)]:mb-0">
            {check.lines.map((line) => (
              <p key={line} className="text-pretty">
                {line}
              </p>
            ))}
          </AlertDescription>
          {/* Under the icon too: the one address to compare gets the callout's whole width, so it wraps in two lines at 360. */}
          <div className="col-span-full mt-1 flex flex-col text-foreground">
            <span className="text-sm font-semibold">{roleLabel(check.role)}</span>
            <AddressText address={check.address} variant="full" explorer />
          </div>
        </Alert>
      )}
    </section>
  );
}
