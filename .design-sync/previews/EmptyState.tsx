import { Button, EmptyState } from '@stakeward/design-system';
import { LockIcon } from 'lucide-react';

/** /stats before anyone has protected a stake: its own icon, one line, and the screen's one filled button. */
export const NothingLockedYet = () => (
  <EmptyState icon={LockIcon} title="Nothing locked yet" action={<Button>Check your stake</Button>}>
    <p>Stakeward does not watch any locked stake account yet. The numbers appear here once someone protects their stake.</p>
  </EmptyState>
);

/** The default icon with an outline action: /recovery for an address where no stake account exists. */
export const AccountNotFound = () => (
  <EmptyState title="No account exists at this address" action={<Button variant="outline">Look up a wallet's stake accounts</Button>}>
    <p>
      Check the address. A stake account is closed when everything in it is withdrawn, or when it is merged into another
      stake account with the same keys. Look up the stake accounts of your main key to find the rest.
    </p>
  </EmptyState>
);

/** An h3 inside a wizard step, one line and no action: the rescue found nothing left under this main key. */
export const NestedNoAction = () => (
  <EmptyState title="No stake accounts found" headingLevel={3}>
    <p>No stake account has this main key now. If it was moved already, Stakeward cannot bring it back.</p>
  </EmptyState>
);
