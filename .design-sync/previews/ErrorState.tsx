import { Button, ErrorState } from '@stakeward/design-system';

const noop = () => undefined;

/** /app when the network read fails: what happened in plain words, the raw error under Details, and Try again. */
export const NetworkWithRetry = () => (
  <ErrorState
    title="Could not load the stake accounts"
    message="The Solana network did not respond. Check your connection and try again."
    detail="HTTP 503 Service Unavailable"
    onRetry={noop}
  />
);

/** A wallet slot that could not connect: Try again, and a second way out, another wallet. No raw error to show. */
export const WithExtraAction = () => (
  <ErrorState
    title="Could not connect Sample Wallet"
    message="The wallet did not share an account. Unlock it, then try again."
    onRetry={noop}
    actions={
      <Button variant="ghost" size="sm">
        Choose another wallet
      </Button>
    }
  />
);

/**
 * A signing round stopped by Stakeward's own check: a wallet added its checks after another had signed. Nothing to
 * retry as is: start again with that wallet first (the screen's one filled button), start again as before, or go back.
 */
export const SigningStopped = () => (
  <ErrorState
    title="Nothing was sent"
    message="The wallet added its own checks after another wallet had signed, which breaks that signature. Nothing was sent."
    detail="tail-not-first-signer: The wallet appended Lighthouse instructions to a transaction that was already signed; only the first wallet to sign may do that"
    actions={
      <>
        <Button size="sm" className="h-auto min-h-8 max-w-full whitespace-normal">
          Start again with Sample Wallet signing first
        </Button>
        <Button variant="outline" size="sm">
          Start again
        </Button>
        <Button variant="ghost" className="h-auto min-h-10 max-w-full whitespace-normal">
          Stop and go back. Nothing was sent.
        </Button>
      </>
    }
  />
);

/** No Try again: Stakeward's inspector refused its own transaction, so the only way on is back. */
export const NoRetry = () => (
  <ErrorState
    title="Could not prepare the transactions"
    message="Stakeward could not read its own transaction, so it will not ask you to sign it. Nothing was sent. Please report this."
    detail="bad-layout: Expected SetComputeUnitLimit then SetComputeUnitPrice right after the optional AdvanceNonceAccount"
    actions={
      <Button variant="ghost" className="h-auto min-h-10 max-w-full whitespace-normal">
        Stop and go back. Nothing was sent.
      </Button>
    }
  />
);
