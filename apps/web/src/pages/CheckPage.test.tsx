import { AccountRole, blockhash, getBase58Decoder, getBase64Decoder, type Instruction } from '@solana/kit';
import { buildTransaction, cosignFragment, type BlockhashLifetime } from '@stakeward/core';
import { craft, instructionsOf, key } from '@stakeward/core/test/craft';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { CheckPage } from './CheckPage.tsx';

// /check (DECISIONS.md D126): a pasted transaction is read in the browser, nothing is sent, every instruction is
// listed with its risk, and new owners are shown in full.

const A = key(1); // the viewer's main key
const K = key(2);
const S = key(4);
const THIEF = key(8);
const LIFETIME: BlockhashLifetime = { kind: 'blockhash', blockhash: blockhash(key(20)), lastValidBlockHeight: 1n };

/** A rescue (AuthorizeChecked Staker + Withdrawer to THIEF) hidden after an instruction of some other program. */
function hiddenHandover(): Uint8Array {
  const rescue = buildTransaction(
    { kind: 'rescue', stakeAccount: S, mainKey: A, secondKey: K, newWallet: THIEF },
    { feePayer: THIEF, lifetime: LIFETIME },
  );
  const decoy: Instruction = {
    programAddress: key(60),
    accounts: [{ address: A, role: AccountRole.WRITABLE_SIGNER }],
    data: Uint8Array.of(7),
  };
  return craft([decoy, ...instructionsOf(rescue.bytes)], A, key(20));
}

function renderAt(path = '/check') {
  const { hook, searchHook } = memoryLocation({ path, static: true });
  return render(
    <Router hook={hook} searchHook={searchHook}>
      <CheckPage />
    </Router>,
  );
}

function paste(text: string) {
  fireEvent.change(screen.getByLabelText('Transaction'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Check' }));
}

describe('CheckPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts empty, says nothing is sent, and asks for a transaction before checking', () => {
    renderAt();
    expect(screen.getByRole('heading', { level: 1, name: 'Check a transaction' })).toBeInTheDocument();
    expect(screen.getByText('Checked in your browser. Nothing is sent.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nothing checked yet' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.getByLabelText('Transaction')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Paste a transaction first.')).toBeInTheDocument();
  });

  it('finds the hidden hand-over, names the new owner in full and marks the viewer wallet, sending nothing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderAt(`/check?address=${A}`);
    expect(screen.getByLabelText('Your wallet (optional)')).toHaveValue(A);
    paste(getBase64Decoder().decode(hiddenHandover()));

    expect(await screen.findByText('Do not sign unless you expected this')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem').filter((item) => item.dataset.slot === 'check-instruction');
    expect(items.map((item) => item.dataset.risk)).toEqual(['caution', 'ok', 'ok', 'danger', 'danger']);
    const withdrawer = items[4];
    if (withdrawer === undefined) throw new Error('no withdrawer instruction');
    expect(within(withdrawer).getByText('Danger')).toBeInTheDocument();
    expect(within(withdrawer).getByText(/Gives the right to withdraw this stake to another address/)).toBeInTheDocument();
    expect(within(withdrawer).getByText('Your wallet loses control here.')).toBeInTheDocument();
    // The new owner in full, not shortened.
    const newAddress = within(withdrawer).getByText('New address').nextElementSibling;
    expect(newAddress).toHaveTextContent(THIEF);
    expect(within(items[0] as HTMLElement).getByText('Unknown program')).toBeInTheDocument();
    // Not Stakeward's own format (a foreign instruction in front).
    expect(screen.queryByText('This is a transaction Stakeward itself builds.')).not.toBeInTheDocument();

    // Ask your AI: descriptions and the verdict, never the raw bytes.
    const chatgpt = screen.getByRole('link', { name: /Ask ChatGPT/ });
    const prompt = new URL(chatgpt.getAttribute('href') ?? '').searchParams.get('q') ?? '';
    expect(prompt).toContain('Explain in plain words what this Solana transaction would do to my stake, and whether I should sign it.');
    expect(prompt).toContain(`New address: ${THIEF}`);
    expect(prompt).toContain('Stakeward says: Do not sign unless you expected this.');
    expect(prompt).not.toContain(getBase64Decoder().decode(hiddenHandover()).slice(0, 40));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('recognises a Stakeward transaction pasted as base58 or as a /cosign link', async () => {
    const protect = buildTransaction(
      { kind: 'protect', stakeAccount: S, mainKey: A, secondKey: K, lockUntil: 1_825_545_600n },
      { feePayer: A, lifetime: LIFETIME },
    );
    renderAt();
    paste(getBase58Decoder().decode(protect.bytes));
    expect(await screen.findByText('This is a transaction Stakeward itself builds.')).toBeInTheDocument();
    expect(screen.getByText('The lock ends on 7 November 2027.')).toBeInTheDocument();
    paste(`https://stakeward.app/cosign#${cosignFragment(protect.bytes)}`);
    await waitFor(() => {
      expect(screen.getByText('This is a transaction Stakeward itself builds.')).toBeInTheDocument();
    });
  });

  it('says when the input is not a transaction, with the raw error under Details', async () => {
    renderAt();
    paste('AAAA');
    expect(await screen.findByText('Stakeward cannot read this as a transaction')).toBeInTheDocument();
    expect(screen.getByText('Details')).toBeInTheDocument();
    paste(A);
    expect(await screen.findByText('This is an address, not a transaction')).toBeInTheDocument();
  });

  it('clears what looks like a recovery phrase and warns', async () => {
    renderAt();
    paste('abandon ability able about above absent absorb abstract absurd abuse access accident');
    expect(await screen.findByText('Never paste this anywhere')).toBeInTheDocument();
    expect(screen.getByLabelText('Transaction')).toHaveValue('');
  });

  it('refuses a wallet field that is not an address', () => {
    renderAt();
    fireEvent.change(screen.getByLabelText('Your wallet (optional)'), { target: { value: 'not-an-address' } });
    paste('AAAA');
    expect(screen.getByText(/This is not a Solana address/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nothing checked yet' })).toBeInTheDocument();
  });
});
