import { AddressTextSkeleton } from '@stakeward/design-system';

// A DS state only: no product screen renders AddressTextSkeleton (a loading account row is AccountRowSkeleton, a
// loading key list KeyListSkeleton).

/** The short variant (default): the footprint of a short address with its copy and explorer buttons. */
export const Short = () => <AddressTextSkeleton />;

/** The full variant: the whole width of its container, where a full address would wrap. */
export const Full = () => (
  <div className="max-w-md">
    <AddressTextSkeleton variant="full" />
  </div>
);
