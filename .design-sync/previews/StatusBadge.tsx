import { StatusBadge } from '@stakeward/design-system';

/** Every protection status a stake account can have, as the accounts list shows them. */
export const AllStatuses = () => (
  <div className="flex flex-wrap items-center gap-2">
    <StatusBadge status="protected" />
    <StatusBadge status="expiring" />
    <StatusBadge status="unprotected" />
    <StatusBadge status="was-protected" />
    <StatusBadge status="locked-by-other" />
    <StatusBadge status="unknown" />
  </div>
);

/** A lock this browser cannot call the viewer's: "Locked by a second key" on a new device, "Locked by another key" once a second key is known. */
export const LockedByAnotherKey = () => (
  <div className="flex flex-wrap items-center gap-2">
    <StatusBadge status="locked-by-other" />
    <StatusBadge status="locked-by-other" secondKeyKnown />
  </div>
);

/** `sm` in rows and lists, `md` where the badge stands on its own. */
export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-3">
    <StatusBadge status="protected" size="sm" />
    <StatusBadge status="protected" size="md" />
    <StatusBadge status="expiring" size="md" />
  </div>
);
