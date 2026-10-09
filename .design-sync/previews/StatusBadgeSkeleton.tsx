import { StatusBadge, StatusBadgeSkeleton } from '@stakeward/design-system';

/** The badge's loading footprint, a pill. A DS state no product screen renders (a loading row is AccountRowSkeleton). */
export const Default = () => <StatusBadgeSkeleton />;

/** Between small StatusBadges: the same height and pill shape. */
export const BesideLoadedBadges = () => (
  <div className="flex flex-wrap items-center gap-2">
    <StatusBadge status="protected" size="sm" />
    <StatusBadgeSkeleton />
    <StatusBadge status="unprotected" size="sm" />
  </div>
);
