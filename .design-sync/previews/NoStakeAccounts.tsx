import { Button, NoStakeAccounts } from '@stakeward/design-system';

/**
 * /app for an address with no native stake: the checked address (to spot a wrong paste) and what is protected. No
 * action of its own: the address field right above it is the way on.
 */
export const CheckedAddress = () => <NoStakeAccounts address="ndzhVeZpY8BRWqkFtY4BUWHRb32nD3J9NrVq6Bz5vCD" />;

/** Inside /protect's first step (h3): the connected main key has nothing to lock, so the step offers the way back. */
export const InWizardStep = () => (
  <NoStakeAccounts
    address="ndzhVeZpY8BRWqkFtY4BUWHRb32nD3J9NrVq6Bz5vCD"
    headingLevel={3}
    action={
      <Button size="sm" variant="outline">
        Back to your accounts
      </Button>
    }
  />
);
