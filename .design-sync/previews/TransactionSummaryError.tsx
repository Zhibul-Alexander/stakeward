import { Button, TransactionSummaryError } from '@stakeward/design-system';

// The inspector refused the bytes, so there is nothing to sign: this stands where the summary would be, with no Sign
// button. A DS state no product screen renders (the product's signing panel and /cosign show a refusal with ErrorState
// and StopPanel). The headline comes from the error code; each `message` is the inspector's own English for "Details"
// (packages/core inspect.ts); the action slot holds the one way out.

const close = (
  <Button size="sm" variant="outline">
    Close
  </Button>
);

/** Refused for the unknown-program code: an instruction for a program outside the allowed list. */
export const UnknownProgram = () => (
  <TransactionSummaryError
    headingLevel={3}
    error={{
      code: 'unknown-program',
      message: 'Instruction 3 calls TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA, which Stakeward never uses',
    }}
    action={close}
  />
);

/** Refused for the bad-layout code: the compute budget is not the fixed one. */
export const BadLayout = () => (
  <TransactionSummaryError
    headingLevel={3}
    error={{ code: 'bad-layout', message: 'Compute unit limit 1400000 is not the fixed 60000' }}
    action={close}
  />
);

/** Refused for the multiple-stake-accounts code: more than one stake account in one transaction. */
export const MultipleStakeAccounts = () => (
  <TransactionSummaryError
    headingLevel={3}
    error={{ code: 'multiple-stake-accounts', message: 'The transaction touches more than one stake account' }}
    action={close}
  />
);
