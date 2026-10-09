import { Alert, AlertDescription, AlertTitle, Button } from '@stakeward/design-system';
import { CircleAlertIcon, KeyRoundIcon, TriangleAlertIcon } from 'lucide-react';

/**
 * The usual pair: a semibold title in the tone's colour, the explanation under it in the text colour. The signing
 * panel when a transaction expired before every wallet signed: Sign again is the screen's one filled button, Back ghost.
 */
export const WithDescription = () => (
  <Alert tone="warning" role="note">
    <TriangleAlertIcon aria-hidden="true" />
    <AlertTitle>The transaction expired before every wallet signed</AlertTitle>
    <AlertDescription className="flex flex-col gap-3 text-foreground">
      <p>Nothing was sent. Sign again: each wallet approves once more.</p>
      <div className="flex flex-wrap gap-2">
        <Button>Sign again</Button>
        <Button variant="ghost" className="h-auto min-h-10 max-w-full whitespace-normal">
          Back
        </Button>
      </div>
    </AlertDescription>
  </Alert>
);

/** A title in the text colour (`className="text-foreground"`): /recovery for a lock it cannot write a card for. */
export const InTextColour = () => (
  <Alert tone="warning">
    <CircleAlertIcon aria-hidden="true" />
    <AlertTitle className="text-foreground">Stakeward cannot write a card for this lock</AlertTitle>
    <AlertDescription className="flex flex-col gap-3 text-foreground">
      <p>
        This lock is held by an epoch or by no key. Stakeward never sets such a lock. Ask whoever set it up how it is
        released.
      </p>
      <div>
        <Button variant="outline">Back to your accounts</Button>
      </div>
    </AlertDescription>
  </Alert>
);

/** A title that is the page's heading: /cosign wraps an h2 in it when the link is cut off. */
export const AsPageHeading = () => (
  <Alert tone="warning">
    <TriangleAlertIcon aria-hidden="true" />
    <AlertTitle>
      <h2 className="text-lg">This link is incomplete</h2>
    </AlertTitle>
    <AlertDescription className="flex flex-col gap-3 text-foreground [&_p:not(:last-child)]:mb-0">
      <p>Ask the sender to send the whole link again. Nothing was signed.</p>
      <div>
        <Button variant="outline">Back to the start page</Button>
      </div>
    </AlertDescription>
  </Alert>
);

/** Neutral: the title and the body both in the text colour. The recovery card's note on what a new key is. */
export const NeutralNote = () => (
  <Alert tone="neutral" role="note">
    <KeyRoundIcon aria-hidden="true" />
    <AlertTitle>A new key means a new seed phrase</AlertTitle>
    <AlertDescription>
      <p>
        Pick a new Ledger, a spare Ledger reset with a new seed phrase, or a keypair file from solana-keygen new. Never use
        the Ledger that holds your main key or your second key, not even another account on it.
      </p>
    </AlertDescription>
  </Alert>
);
