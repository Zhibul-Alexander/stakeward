import { TransactionCheck } from '@stakeward/design-system';
import { SAMPLE_SCANS } from '../../apps/web/src/pages/dev-ui/samples';

// /check's result section (an h2), as the page renders it: idle until Check, then the verdict from the pasted bytes.

/** The SwissBorg shape: a transfer hides an AuthorizeChecked that hands the right to withdraw to a stranger. */
export const HiddenAuthorize = () => <TransactionCheck state={{ status: 'ready', report: SAMPLE_SCANS.danger }} />;

/** A v0 transaction: an unstake plus an unknown program whose accounts sit behind a lookup table. */
export const LookupTable = () => <TransactionCheck state={{ status: 'ready', report: SAMPLE_SCANS.caution }} />;

/** A plain SOL transfer: no stake instruction, listed but not judged. */
export const NoStakeTouched = () => <TransactionCheck state={{ status: 'ready', report: SAMPLE_SCANS.ok }} />;

/** Before anything is pasted: what to do, and that Stakeward does not sign or send it. */
export const NothingChecked = () => <TransactionCheck state={{ status: 'idle' }} />;

/** While core reads the bytes in the browser. */
export const Checking = () => <TransactionCheck state={{ status: 'checking' }} />;

/** Bytes that do not decode: what to do next, the decoder's own message under Details. */
export const Unreadable = () => (
  <TransactionCheck state={{ status: 'error', code: 'malformed', detail: 'Not a transaction: SolanaError' }} />
);
