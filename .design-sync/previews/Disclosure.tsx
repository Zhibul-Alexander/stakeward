import { AddressText, Alert, AlertDescription, Disclosure } from '@stakeward/design-system';
import { ClockIcon, TriangleAlertIcon } from 'lucide-react';

const signingAccount = 'HchUMm8CfoKw5Gz1PD8TUexMfXPXK8ALkb2tKH7Q75Kx';

/** The lifetime line at the foot of a signing summary on a link-signing account, as TransactionSummary renders it. */
function Lifetime({ open }: { open?: boolean }) {
  return (
    <div className="flex max-w-prose flex-col gap-2 text-sm">
      <p className="flex items-start gap-2 text-muted">
        <ClockIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        Valid until it is sent or cancelled.
      </p>
      <Disclosure summary="Technical details" defaultOpen={open}>
        <div className="flex flex-col gap-2">
          <div className="flex flex-col">
            <span className="text-muted">Link-signing account</span>
            <AddressText address={signingAccount} variant="full" />
          </div>
        </div>
      </Disclosure>
    </div>
  );
}

/** `inline`, closed: a text link with a chevron, for what most people never need to open (the signing summary's Technical details). */
export const InlineClosed = () => <Lifetime />;

/** `inline`, open: the chevron turns down and the content follows under the link: the link-signing account in full. */
export const InlineOpen = () => <Lifetime open />;

/** Details inside a warning: /extend on a lock Stakeward cannot change says what and folds the why. */
export const DetailsInWarning = () => (
  <Alert tone="warning" role="note">
    <TriangleAlertIcon aria-hidden="true" />
    <AlertDescription className="flex flex-col gap-2 text-foreground">
      <p className="font-medium">Stakeward cannot change this lock: it is held by the main key itself or by no key.</p>
      <Disclosure summary="Details" defaultOpen className="text-sm">
        <p className="max-w-prose">
          If the main key holds it, the Solana command line can change it. The main key signs as the lock's key: solana
          stake-set-lockup --help names that option. Otherwise wait until the lock ends.
        </p>
      </Disclosure>
    </AlertDescription>
  </Alert>
);

/** `row`, open: a full-width line with the chevron at its end, the look an FAQ question shares. */
export const RowOpen = () => (
  <Disclosure summary="I lost my second key. What now?" variant="row" defaultOpen className="border-y border-border">
    <p>
      Your SOL is safe, but it stays locked until the lock's end date. Then your main key alone can withdraw it, or protect
      it again with a new second key. Nobody can shorten the wait, not even Stakeward.
    </p>
  </Disclosure>
);
