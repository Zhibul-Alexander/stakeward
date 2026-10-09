import { AccountListSkeleton } from '@stakeward/design-system';
import { LoaderCircleIcon } from 'lucide-react';

/** The default, two row skeletons: /protect (as here), /rescue and the recovery card while they read the stake accounts. */
export const TwoRows = () => (
  <div aria-busy="true" className="flex flex-col gap-3">
    <p role="status" className="flex items-center gap-2 text-sm text-muted">
      <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
      Reading your stake accounts from the network
    </p>
    <AccountListSkeleton />
  </div>
);

/** /app while it reads a wallet: the line that says so, then three row skeletons. */
export const ThreeRows = () => (
  <div aria-busy="true" className="flex flex-col gap-3">
    <p role="status" className="flex items-center gap-2 text-sm text-muted">
      <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
      Reading stake accounts from the network
    </p>
    <AccountListSkeleton rows={3} />
  </div>
);

/** /withdraw and /extend read one account: a single row in the list's frame, then the line that says so. */
export const OneRow = () => (
  <div className="flex flex-col gap-3">
    <AccountListSkeleton rows={1} />
    <p role="status" className="flex items-center gap-2 text-sm text-muted">
      <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
      Reading this stake account from the network
    </p>
  </div>
);
