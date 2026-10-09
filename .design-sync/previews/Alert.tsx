import { AddressText, Alert, AlertDescription, AlertTitle, Button, RiskNote } from '@stakeward/design-system';
import { CircleCheckIcon, InfoIcon, KeyRoundIcon, OctagonXIcon, ShieldCheckIcon, ShieldXIcon, TriangleAlertIcon } from 'lucide-react';

const MAIN_KEY = 'B1agBSrGRgub2jXMJEozYkRLRzFc9HLd5hHjSrCtuXu8';
const STRANGER = 'ndzhVeZpY8BRWqkFtY4BUWHRb32nD3J9NrVq6Bz5vCD';
const TX = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';
// A 6-month lock under the fixed clock (9 October 2026) ends 10 April 2027.
const LOCK_END = 1_807_315_200n;

/**
 * Every tone, each as a screen shows it. Neutral, success, warning and info are a soft fill without a frame; danger is
 * the only framed alert, the one shout on a screen. The body is in the text colour. Neutral: the recovery card's new-key
 * note. Success: a confirmed send (only /dev/cosign uses this tone). Warning and danger: RiskNote, the Alert the protect
 * and remove-lock screens show (its date never splits across lines). Info: the signing panel after it rebuilt expired
 * transactions.
 */
export const Tones = () => (
  <div className="flex flex-col gap-3">
    <Alert tone="neutral" role="note">
      <KeyRoundIcon aria-hidden="true" />
      <AlertTitle>A new key means a new seed phrase</AlertTitle>
      <AlertDescription>
        <p>
          Pick a new Ledger, a spare Ledger reset with a new seed phrase, or a keypair file from solana-keygen new. Never
          use the Ledger that holds your main key or your second key, not even another account on it.
        </p>
      </AlertDescription>
    </Alert>
    <Alert tone="success">
      <CircleCheckIcon aria-hidden="true" />
      <AlertDescription className="flex flex-col gap-1 text-foreground">
        <p className="font-medium">Confirmed on devnet.</p>
        <AddressText address={TX} kind="tx" />
      </AlertDescription>
    </Alert>
    <RiskNote risk="lose-second-key" date={LOCK_END} />
    <Alert tone="info" role="note">
      <InfoIcon aria-hidden="true" />
      <AlertDescription className="text-foreground">
        The transactions were built again: the earlier ones would have expired before every wallet signed. Check them,
        then sign.
      </AlertDescription>
    </Alert>
    <RiskNote risk="unlock-opens-window" tone="danger" />
  </div>
);

/**
 * The /app banner when locks this device saw have ended (F6): the page's only red block, with its one filled button.
 * From 640 px the text and the button share one row.
 */
export const NoLongerProtected = () => (
  <Alert tone="danger">
    <ShieldXIcon aria-hidden="true" />
    <AlertTitle>2 stake accounts are no longer protected</AlertTitle>
    <AlertDescription className="flex flex-col gap-3 text-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <p>This device saw them protected, but their lock has ended. Anyone with your main key can withdraw them now.</p>
      <div className="shrink-0">
        <Button variant="danger" size="sm">
          <ShieldCheckIcon aria-hidden="true" />
          Protect again
        </Button>
      </div>
    </AlertDescription>
  </Alert>
);

/** A warning in place of the page, with the way forward: /recovery for a stake account without a lock. */
export const NotProtected = () => (
  <Alert tone="warning">
    <TriangleAlertIcon aria-hidden="true" />
    <AlertTitle className="text-foreground">This stake account is not protected</AlertTitle>
    <AlertDescription className="flex flex-col gap-3 text-foreground">
      <p>
        No second key holds a lock on it, so anyone with its main key can withdraw it. Protect it first, then come back
        for its recovery card.
      </p>
      <div>
        <Button>
          <ShieldCheckIcon aria-hidden="true" />
          Protect it
        </Button>
      </div>
    </AlertDescription>
  </Alert>
);

/**
 * `size="lg"`: the /cosign stop panel. A thicker frame, a larger icon and text; never folded. Its h2 sits straight in
 * the alert and names it; the reason comes with the addresses it is about, labelled and in full, then what to do and
 * one way out.
 */
export const StopPanelSize = () => (
  <Alert tone="danger" size="lg" aria-labelledby="stop-panel-title">
    <OctagonXIcon aria-hidden="true" />
    <h2 id="stop-panel-title" className="text-2xl text-balance outline-none">
      Do not sign this link
    </h2>
    <AlertDescription className="flex flex-col gap-4 text-foreground [&_p:not(:last-child)]:mb-0">
      <p className="font-medium">
        It sends 1,250.5 SOL to a wallet that is not this stake&apos;s Main key. Stakeward never does that.
      </p>
      <dl className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <dt className="text-sm font-semibold">SOL would go to</dt>
          <dd>
            <AddressText address={STRANGER} variant="full" explorer />
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-sm font-semibold">Main key of this stake</dt>
          <dd>
            <AddressText address={MAIN_KEY} variant="full" explorer />
          </dd>
        </div>
      </dl>
      <p>What to do: tell the owner by phone or in person. Someone may have their Main key.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline">Back to the start page</Button>
      </div>
    </AlertDescription>
  </Alert>
);

/** Icon and body only, no title: signing by link when the link-signing account's address is taken. */
export const DescriptionOnly = () => (
  <Alert tone="warning">
    <TriangleAlertIcon aria-hidden="true" />
    <AlertDescription className="flex flex-col gap-2 text-foreground">
      <p>
        The address of your link-signing account is already taken by another account, so it cannot be created. Anyone
        can do this by sending a tiny amount of SOL to it.
      </p>
      <p className="font-medium">Sign in this browser instead.</p>
    </AlertDescription>
  </Alert>
);
