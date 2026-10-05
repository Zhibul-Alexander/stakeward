import { commandDisplayLines, commandLine, recoveryCommands } from '@stakeward/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandBlock } from './command-block.tsx';

const ACCOUNT = 'AYA9kYsn7XVDTPARBfAuASypyyDGFJw1Xds2vHgW9DfW';
const WITHDRAW = recoveryCommands({ mainKeyAddress: ACCOUNT, url: 'mainnet-beta' }).withdraw;

describe('CommandBlock', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the command over several lines exactly as core lays it out, placeholders in bold', () => {
    const { container } = render(<CommandBlock argv={WITHDRAW} label="withdraw with both keys" />);
    const code = container.querySelector('pre code');
    expect(code?.textContent).toBe(commandDisplayLines(WITHDRAW).join('\n'));
    const bold = [...container.querySelectorAll('code span.font-semibold')].map((span) => span.textContent);
    expect(bold).toEqual(['<STAKE_ACCOUNT>', '<MAIN_KEY>', '<MAIN_KEY>', '<SECOND_KEY>', '<MAIN_KEY>']);
  });

  it('copies the one-line form, which every shell accepts, and says so', async () => {
    const user = userEvent.setup();
    render(<CommandBlock argv={WITHDRAW} label="withdraw with both keys" />);
    await user.click(screen.getByRole('button', { name: 'Copy the command: withdraw with both keys' }));
    expect(await navigator.clipboard.readText()).toBe(commandLine(WITHDRAW));
    expect(commandLine(WITHDRAW)).not.toContain('\\');
    expect(screen.getByRole('status')).toHaveTextContent('Command copied');
  });

  it('when the clipboard refuses, says how to copy by hand', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('NotAllowedError'));
    render(<CommandBlock argv={WITHDRAW} label="withdraw with both keys" />);
    await user.click(screen.getByRole('button', { name: 'Copy the command: withdraw with both keys' }));
    expect(screen.getByRole('status')).toHaveTextContent('Could not copy. Select the command and copy it by hand.');
    expect(screen.getByText('Copy failed')).toBeVisible();
  });

  it('a command that is not a solana subcommand stays on one line', () => {
    const { container } = render(<CommandBlock argv={['solana-keygen', 'pubkey', '"usb://ledger?key=0"']} label="ledger" />);
    expect(container.querySelector('pre code')?.textContent).toBe('solana-keygen pubkey "usb://ledger?key=0"');
  });
});
