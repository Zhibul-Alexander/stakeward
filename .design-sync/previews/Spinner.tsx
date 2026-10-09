import { Badge, Button, Spinner } from '@stakeward/design-system';

/**
 * size-4 inline with a short line, size-5 next to a wait the step depends on, size-6 alone while a page's code loads.
 * Muted, and it stands still under reduced motion.
 */
export const Sizes = () => (
  <div className="flex flex-col gap-4">
    <p className="flex items-center gap-1.5 text-sm text-muted">
      <Spinner aria-hidden="true" className="size-4" />
      Checking monitoring
    </p>
    <p role="status" className="flex items-center gap-3 text-sm">
      <Spinner className="size-5 shrink-0 text-muted" />
      <span>Checking your link-signing account</span>
    </p>
    <div className="flex justify-center py-12">
      <Spinner className="size-6 text-muted" />
    </div>
  </div>
);

/** Every wait is explained and has a way out: waiting for the wallet, and a wallet asked to connect. */
export const WithWayOut = () => (
  <div className="flex flex-col gap-5">
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="flex min-w-0 items-center gap-3">
        <Spinner className="size-5 shrink-0 text-muted" />
        <span className="min-w-0">Waiting for Phantom: approve or reject the request there.</span>
      </span>
      <Button variant="outline" size="sm">
        Stop waiting
      </Button>
    </div>
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 text-sm">
        <Spinner className="size-5 text-muted" />
        <span>Approve the connection in Phantom.</span>
      </div>
      <div>
        <Button variant="outline" size="sm">
          Cancel
        </Button>
      </div>
    </div>
  </div>
);

/** Inside a badge: the link card while it waits for the other device. */
export const InBadge = () => (
  <Badge tone="info" size="md">
    <Spinner aria-hidden="true" />
    Waiting for the other device
  </Badge>
);
