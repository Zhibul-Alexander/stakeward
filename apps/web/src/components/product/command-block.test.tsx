import { commandLine, LEDGER_PUBKEY_COMMAND, recoveryCommands } from '@stakeward/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandBlock, CommandBlockSkeleton } from './command-block.tsx';

const MAIN = 'B1agBSrGRgub2jXMJEozYkRLRzFc9HLd5hHjSrCtuXu8';
const COMMANDS = recoveryCommands({ mainKeyAddress: MAIN, url: 'devnet' });
const LABEL = 'Withdraw with both keys';

/** What bash and zsh read from the display form: line continuations removed, the indentation collapsed. */
function shellLine(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/ \\$/, '').trim())
    .join(' ');
}

describe('CommandBlock', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows one line per argument, every line but the last ending in " \\" (spec L7)', () => {
    render(<CommandBlock argv={COMMANDS.withdraw} label={LABEL} />);
    const group = screen.getByRole('group', { name: LABEL });
    expect(group).toHaveAttribute('data-slot', 'command-block');
    const text = group.querySelector('pre')?.textContent ?? '';
    const lines = text.split('\n');
    expect(lines).toEqual([
      'solana withdraw-stake \\',
      '  <STAKE_ACCOUNT> \\',
      '  <MAIN_KEY> \\',
      '  ALL \\',
      '  --withdraw-authority <MAIN_KEY> \\',
      '  --custodian <SECOND_KEY> \\',
      '  --fee-payer <MAIN_KEY> \\',
      '  --url devnet',
    ]);
    // The display form is the same command a shell runs.
    expect(shellLine(text)).toBe(commandLine(COMMANDS.withdraw));
  });

  it('shows a command that is not `solana <sub>` on one line', () => {
    render(<CommandBlock argv={LEDGER_PUBKEY_COMMAND} label="Show the address of a Ledger key" />);
    expect(screen.getByRole('group').querySelector('pre')).toHaveTextContent(/^solana-keygen pubkey "usb:\/\/ledger\?key=0"$/);
  });

  it('wraps long words at 360 px and does not split across printed pages', () => {
    render(<CommandBlock argv={COMMANDS.rescue} label={LABEL} />);
    const group = screen.getByRole('group', { name: LABEL });
    expect(group).toHaveClass('print:break-inside-avoid');
    expect(group.querySelector('pre')).toHaveClass('whitespace-pre-wrap', 'wrap-anywhere', 'font-mono');
  });

  it('copies the command as one line and says so', async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, 'writeText');
    render(<CommandBlock argv={COMMANDS.rescue} label={LABEL} />);
    await user.click(screen.getByRole('button', { name: `Copy the command: ${LABEL}` }));
    expect(write).toHaveBeenCalledWith(commandLine(COMMANDS.rescue));
    expect(await navigator.clipboard.readText()).toBe(commandLine(COMMANDS.rescue));
    expect(screen.getByRole('status')).toHaveTextContent('Command copied');
    expect(screen.queryByText('Copy failed')).not.toBeInTheDocument();
  });

  it('when the clipboard refuses, shows a short failure and announces how to copy by hand', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('NotAllowedError'));
    render(<CommandBlock argv={COMMANDS.withdraw} label={LABEL} />);
    await user.click(screen.getByRole('button', { name: `Copy the command: ${LABEL}` }));
    expect(screen.getByRole('status')).toHaveTextContent('Could not copy. Select the command and copy it by hand.');
    expect(screen.getByText('Copy failed')).toBeVisible();
  });

  it('hides the copy button in print: paper cannot copy', () => {
    render(<CommandBlock argv={COMMANDS.withdraw} label={LABEL} />);
    expect(screen.getByRole('button', { name: `Copy the command: ${LABEL}` })).toHaveClass('print:hidden');
  });

  it('feedback fixes the copy state for /dev/ui: copied and failed without pressing the button', () => {
    const { rerender } = render(<CommandBlock argv={COMMANDS.withdraw} label={LABEL} feedback="copied" />);
    expect(screen.getByRole('status')).toHaveTextContent('Command copied');
    rerender(<CommandBlock argv={COMMANDS.withdraw} label={LABEL} feedback="failed" />);
    expect(screen.getByText('Copy failed')).toBeVisible();
  });

  it('loading: a decorative skeleton', () => {
    const { container } = render(<CommandBlockSkeleton />);
    expect(container.querySelector('[data-slot="skeleton"]')).toHaveAttribute('aria-hidden', 'true');
  });
});
