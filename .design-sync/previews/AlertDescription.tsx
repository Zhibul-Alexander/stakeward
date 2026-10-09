import { Alert, AlertDescription, AlertTitle, Button } from '@stakeward/design-system';
import { CircleAlertIcon, ShieldAlertIcon, TriangleAlertIcon } from 'lucide-react';

/**
 * Paragraphs get space between them; a link in prose stays underlined (it is not told apart by colour alone). The
 * recovery card's first block: check the second key before anything else.
 */
export const ParagraphsAndLink = () => (
  <Alert tone="warning" role="note">
    <ShieldAlertIcon aria-hidden="true" />
    <AlertTitle className="text-foreground">Check the second key first</AlertTitle>
    <AlertDescription className="text-foreground">
      <p>
        Compare the Second key below with the wallet you use as your second key. If they differ, someone else holds this
        lock: they can keep your stake locked. They still cannot move your SOL without the main key.
      </p>
      <p>
        <a
          href="/#faq-locked-by-other"
          className="rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
        >
          Why a stake account says Locked by a second key
        </a>
      </p>
    </AlertDescription>
  </Alert>
);

/** What happened, then the one way out: /recovery opened with an address that is not one. */
export const WithWayOut = () => (
  <Alert tone="danger">
    <CircleAlertIcon aria-hidden="true" />
    <AlertDescription className="flex flex-col gap-3 text-foreground">
      <p className="font-medium">This page address does not contain a valid stake account address.</p>
      <div>
        <Button variant="outline">Back to your accounts</Button>
      </div>
    </AlertDescription>
  </Alert>
);

/** A lead line in medium weight, the reason in regular text under it: the rescue's same-wallet warning. */
export const LeadAndReason = () => (
  <Alert tone="warning" role="note">
    <TriangleAlertIcon aria-hidden="true" />
    <AlertDescription className="flex flex-col gap-1 text-foreground">
      <p className="font-medium">Your new wallet and your main key are both in Phantom.</p>
      <p>
        Accounts of one wallet app, and every account of one Ledger, usually come from one seed phrase. Continue only if
        you made your new wallet from a new seed phrase.
      </p>
    </AlertDescription>
  </Alert>
);
