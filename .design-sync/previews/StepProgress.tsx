import { StepProgress } from '@stakeward/design-system';

// The protect wizard's steps (F1) and the rescue wizard's (F4), as their pages label them (en.json protect.steps,
// rescue.steps). The wizards never fail a step; `failed` comes from the wallet co-signing test (/dev/cosign, devnet
// only), whose steps are each signer, Send and Confirm.
const PROTECT = ['Accounts', 'Second key', 'Lock period', 'Review and sign'];
const RESCUE = ['Your stake', 'New wallet', 'Signers', 'Move', 'Done'];
const COSIGN_TEST = ['Main key signs', 'Second key signs', 'Send', 'Confirm'];

/** Protect, first step: nothing done yet. */
export const FirstStep = () => <StepProgress steps={PROTECT} current={0} />;

/** Protect, third step: two steps done (checks), the current one ringed, the last still ahead. */
export const MiddleStep = () => <StepProgress steps={PROTECT} current={2} />;

/** Rescue's five steps, on the move step. */
export const RescueWizard = () => <StepProgress steps={RESCUE} current={3} />;

/** The co-signing test after the Second key's wallet declined: that step shows an X in danger, "Failed" for screen
 * readers. */
export const Failed = () => <StepProgress steps={COSIGN_TEST} current={1} failed={1} />;
