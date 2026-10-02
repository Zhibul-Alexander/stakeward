import type { Address, ReadonlyUint8Array } from '@solana/kit';
import { compareMessages, decodeWireTransaction, resolveInstructions, shortAddress, type LegacyMessage } from '@stakeward/core';
import { t } from '@/i18n';

/**
 * What a wallet did to the message it was asked to sign, in words for the wallet matrix (CLAUDE.md section 10,
 * step 3). The verdict (accept or stop) is core's `checkSigningStep`; this only describes the change.
 */
export type ChangeCode =
  | 'not-a-transaction'
  | 'version'
  | 'lifetime'
  | 'fee-payer'
  | 'header'
  | 'accounts'
  | 'instructions'
  /** Lighthouse instructions were appended, but the accounts are not laid out the accepted way (D24). */
  | 'tail-layout'
  /** Lighthouse instructions were appended and make an account a signer or writable. */
  | 'tail-privileges'
  | 'other';

export type ChangePart = { code: ChangeCode; text: string };

export type MessageChange =
  | { kind: 'none' }
  | { kind: 'lighthouse-tail'; instructions: number; addedAccounts: readonly Address[] }
  | { kind: 'other'; parts: readonly ChangePart[] };

/** Compares the message of the bytes sent to a wallet with the message of the bytes it returned. Never throws. */
export function describeMessageChange(sent: ReadonlyUint8Array, returned: ReadonlyUint8Array): MessageChange {
  const before = decodeWireTransaction(sent);
  const after = decodeWireTransaction(returned);
  if (!before.ok) return other([{ code: 'not-a-transaction', text: t('devCosign.change.sentInvalid', { message: before.message }) }]);
  if (!after.ok) {
    const code: ChangeCode = after.code === 'malformed' ? 'not-a-transaction' : 'version';
    return other([{ code, text: t(`devCosign.change.${code}`, { message: after.message }) }]);
  }
  const comparison = compareMessages(before.message, after.message);
  switch (comparison.kind) {
    case 'identical':
      return { kind: 'none' };
    case 'lighthouse-tail':
      return { kind: 'lighthouse-tail', instructions: comparison.instructionCount, addedAccounts: comparison.addedAccounts };
    case 'tail-escalates':
      return other([{ code: 'tail-privileges', text: comparison.message }, ...structuralParts(before.message, after.message)]);
    case 'changed': {
      const parts = structuralParts(before.message, after.message);
      if (comparison.tail) parts.unshift({ code: 'tail-layout', text: t('devCosign.change.tail-layout', { message: comparison.message }) });
      return other(parts.length > 0 ? parts : [{ code: 'other', text: comparison.message }]);
    }
  }
}

function other(parts: ChangePart[]): MessageChange {
  return { kind: 'other', parts };
}

/** Lifetime, fee payer, header, account list and instructions: each that differs, in words. */
function structuralParts(a: LegacyMessage, b: LegacyMessage): ChangePart[] {
  const parts: ChangePart[] = [];
  if (a.lifetimeToken !== b.lifetimeToken) {
    parts.push({ code: 'lifetime', text: t('devCosign.change.lifetime', { before: shortAddress(a.lifetimeToken), after: shortAddress(b.lifetimeToken) }) });
  }
  const payerA = a.staticAccounts[0] ?? '';
  const payerB = b.staticAccounts[0] ?? '';
  if (payerA !== payerB) {
    parts.push({ code: 'fee-payer', text: t('devCosign.change.fee-payer', { before: shortAddress(payerA), after: shortAddress(payerB) }) });
  }
  const ha = a.header;
  const hb = b.header;
  if (
    ha.numSignerAccounts !== hb.numSignerAccounts ||
    ha.numReadonlySignerAccounts !== hb.numReadonlySignerAccounts ||
    ha.numReadonlyNonSignerAccounts !== hb.numReadonlyNonSignerAccounts
  ) {
    parts.push({
      code: 'header',
      text: t('devCosign.change.header', {
        signers: arrow(ha.numSignerAccounts, hb.numSignerAccounts),
        readonlySigners: arrow(ha.numReadonlySignerAccounts, hb.numReadonlySignerAccounts),
        readonly: arrow(ha.numReadonlyNonSignerAccounts, hb.numReadonlyNonSignerAccounts),
      }),
    });
  }
  const added = b.staticAccounts.filter((address) => !a.staticAccounts.includes(address));
  const removed = a.staticAccounts.filter((address) => !b.staticAccounts.includes(address));
  const moved = a.staticAccounts.filter((address, index) => b.staticAccounts.includes(address) && b.staticAccounts[index] !== address);
  if (added.length + removed.length + moved.length > 0) {
    const pieces = [t('devCosign.change.accountCount', { count: arrow(a.staticAccounts.length, b.staticAccounts.length) })];
    if (added.length > 0) pieces.push(t('devCosign.change.accountsAdded', { list: added.join(', ') }));
    if (removed.length > 0) pieces.push(t('devCosign.change.accountsRemoved', { list: removed.join(', ') }));
    if (moved.length > 0) pieces.push(t('devCosign.change.accountsMoved', { count: moved.length }));
    parts.push({ code: 'accounts', text: pieces.join('; ') });
  }
  const ia = resolveInstructions(a);
  const ib = resolveInstructions(b);
  const changed: number[] = [];
  for (const [index, ix] of ia.entries()) {
    const next = ib[index];
    if (next !== undefined && !sameInstruction(ix, next)) changed.push(index + 1);
  }
  if (changed.length > 0 || ia.length !== ib.length) {
    const pieces = [t('devCosign.change.instructionCount', { count: arrow(ia.length, ib.length) })];
    if (changed.length > 0) pieces.push(t('devCosign.change.instructionsChanged', { list: changed.join(', ') }));
    if (ib.length > ia.length) {
      const programs = ib.slice(ia.length).map((ix) => shortAddress(ix.programAddress));
      pieces.push(t('devCosign.change.instructionsAppended', { list: programs.join(', ') }));
    }
    parts.push({ code: 'instructions', text: pieces.join('; ') });
  }
  return parts;
}

type Ix = ReturnType<typeof resolveInstructions>[number];

function sameInstruction(a: Ix, b: Ix): boolean {
  return (
    a.programAddress === b.programAddress &&
    a.accounts.length === b.accounts.length &&
    a.accounts.every((meta, index) => meta.address === b.accounts[index]?.address) &&
    a.data.length === b.data.length &&
    a.data.every((byte, index) => byte === b.data[index])
  );
}

function arrow(before: number, after: number): string {
  return before === after ? String(before) : `${String(before)} -> ${String(after)}`;
}
