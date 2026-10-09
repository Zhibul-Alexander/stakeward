import { AccountListSkeleton, AccountRowSkeleton } from '@stakeward/design-system';

/** One row loading in the frame a single row stands in: badge, address and SOL, then the muted line under them. */
export const SingleRow = () => (
  <div aria-hidden="true" className="rounded-lg border border-border bg-surface px-4 py-3">
    <AccountRowSkeleton />
  </div>
);

/**
 * Rows loading in a list: AccountListSkeleton draws the list's frame, padding and hairlines around one row skeleton
 * each. Decorative (aria-hidden); the page announces the loading.
 */
export const InAList = () => <AccountListSkeleton />;
