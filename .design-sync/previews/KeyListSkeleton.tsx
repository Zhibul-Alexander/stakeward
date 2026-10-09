import { KeyListSkeleton } from '@stakeward/design-system';

/** DS loading state (no product screen renders it; /dev/ui only): the default two rows of a KeyList's shape. */
export const TwoKeys = () => <KeyListSkeleton />;

/** The same loading state with rows={1}: one row of a KeyList's shape. */
export const OneKey = () => <KeyListSkeleton rows={1} />;
