import { CommandBlock } from '@stakeward/design-system';
import { cliUrl, LEDGER_PUBKEY_COMMAND, recoveryCommands } from '@stakeward/core';
import { SAMPLE } from '../../apps/web/src/pages/dev-ui/samples';

// The recovery card's commands as core builds them for mainnet; every signing key stays a placeholder.
const commands = recoveryCommands({ mainKeyAddress: SAMPLE.mainKey, url: cliUrl('mainnet') });

/** Rescue without Stakeward: one argument per line, the copy button copies it as one line. */
export const RescueCommand = () => <CommandBlock argv={commands.rescue} label="Move a stake account to the new wallet" />;

/** Just copied: the check icon replaces the copy icon for 2 s. */
export const Copied = () => <CommandBlock argv={commands.withdraw} label="Withdraw with both keys" feedback="copied" />;

/** The clipboard refused: a short failure line under the button. */
export const CopyFailed = () => (
  <CommandBlock argv={LEDGER_PUBKEY_COMMAND} label="Show the address of a Ledger key" feedback="failed" />
);
