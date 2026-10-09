import { Button, StopPanel } from '@stakeward/design-system';
import { SAMPLE } from '../../apps/web/src/pages/dev-ui/samples';

const backHome = <Button variant="outline">Back to the start page</Button>;
const whatToDo = 'What to do: tell the owner by phone or in person. Someone may have their Main key.';

/** A withdrawal to a wallet that is not the Main key: both addresses in full, what to do, one way out. */
export const ForeignRecipient = () => (
  <StopPanel
    title="Do not sign this link"
    reason="It sends 1,250.5 SOL to a wallet that is not this stake's Main key. Stakeward never does that."
    addresses={[
      { label: 'SOL would go to', address: SAMPLE.stranger },
      { label: 'Main key of this stake', address: SAMPLE.mainKey },
    ]}
    whatToDo={whatToDo}
    action={backHome}
    reasonCode="foreign-recipient"
  />
);

/** Bytes the inspector refuses: the reason in plain words, the inspector's own words folded under Details. */
export const UnknownProgram = () => (
  <StopPanel
    title="Do not sign this link"
    reason="This transaction calls a program Stakeward never uses."
    whatToDo={whatToDo}
    detail="Instruction 3 calls TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA, which Stakeward never uses"
    action={backHome}
    reasonCode="unknown-program"
  />
);

/** A protect link over a lock already in force: refused before anything is asked. */
export const AlreadyLocked = () => (
  <StopPanel
    title="Do not sign this link"
    reason="This stake account is already locked, and this link would change when its lock ends. Stakeward never asks for that by link."
    whatToDo={whatToDo}
    action={backHome}
    reasonCode="already-locked"
  />
);
