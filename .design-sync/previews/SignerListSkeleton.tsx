import { SignerListSkeleton } from '@stakeward/design-system';

/** While the transactions are built: two signer cards, the shape of the full SignerList. */
export const Full = () => <SignerListSkeleton />;

/** The compact order's loading state: two one-line keys above the summary. */
export const Compact = () => <SignerListSkeleton variant="compact" />;
