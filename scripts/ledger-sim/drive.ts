// Walks the Ledger review for one transaction the way a person would on a Nano S Plus / Nano X: read the screen,
// press right until the approve screen, press both buttons. A blind-signing refusal is dismissed and recorded.
import { getPublicKeyFromAddress, verifySignature, type Address, type SignatureBytes } from '@solana/kit';
import type { SimCase } from './cases.ts';
import { sleep, type SpeculosClient } from './speculos.ts';

export type Outcome = 'clear-sign' | 'blind-sign' | 'error';

export type CaseResult = {
  case: SimCase;
  outcome: Outcome;
  /** Every screen, in order, each as its text lines (addresses wrap over several lines on the device). */
  screens: string[][];
  status: number;
  /** null when the device returned no signature. */
  signatureValid: boolean | null;
  /** The inspector's verdict on the same bytes (null = accepted). */
  inspectorError: string | null;
};

const IDLE = /app is ready/i;
/** The confirmation the app shows for a moment after signing; it belongs to the previous case. */
const SIGNED = /^Transaction signed$/i;
const APPROVE = /^(Sign transaction|Approve|Accept)$/i;
const BLIND = /blind sign/i;
const MAX_SCREENS = 40;

/** Splits a wire transaction into its signer count and message bytes. */
export function messageOf(bytes: Uint8Array): Uint8Array {
  const count = bytes[0] ?? 0;
  if (count >= 0x80) throw new Error('more than 127 signature slots');
  return bytes.subarray(1 + 64 * count);
}

export async function driveReview(
  device: SpeculosClient,
  path: string,
  ledger: Address,
  simCase: SimCase,
  inspectorError: string | null,
): Promise<CaseResult> {
  const message = messageOf(simCase.bytes);
  await waitForIdle(device);
  const screens: string[][] = [];
  // Set from the review callback, so kept in an object for the type checker.
  const seen = { blind: false };
  const record = async (lines: string[]) => {
    if (lines.some((line) => BLIND.test(line))) {
      seen.blind = true;
      await device.press('both');
    }
  };
  const result = await device.signMessage(path, message, async (screen) => {
    let last = '';
    for (let step = 0; step < MAX_SCREENS && !screen.answered(); step += 1) {
      const lines = await screen.screen();
      const key = lines.join('\n');
      if (screen.answered()) break;
      if (lines.length === 0 || IDLE.test(key) || SIGNED.test(key)) continue;
      if (key !== last) screens.push(lines);
      last = key;
      if (lines.some((line) => BLIND.test(line))) {
        await record(lines);
        continue;
      }
      if (lines.some((line) => APPROVE.test(line))) {
        await screen.press('both');
        return;
      }
      await screen.press('right');
    }
  });
  // A refusal answers the APDU at once and leaves its message on screen.
  if (result.status !== 0x9000) {
    await sleep(300);
    const lines = await device.currentScreen();
    if (lines.length > 0 && !IDLE.test(lines.join('\n'))) {
      screens.push(lines);
      await record(lines);
    }
  }

  let signatureValid: boolean | null = null;
  if (result.status === 0x9000 && result.data.length === 64) {
    const key = await getPublicKeyFromAddress(ledger);
    signatureValid = await verifySignature(key, result.data as SignatureBytes, message);
  }
  const outcome: Outcome = seen.blind ? 'blind-sign' : result.status === 0x9000 && signatureValid ? 'clear-sign' : 'error';
  return { case: simCase, outcome, screens, status: result.status, signatureValid, inspectorError };
}

/** Waits until the app shows its home screen again, dismissing a leftover refusal message. */
async function waitForIdle(device: SpeculosClient): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const key = (await device.currentScreen()).join('\n');
    if (IDLE.test(key)) return;
    if (BLIND.test(key)) await device.press('both');
    await sleep(200);
  }
  throw new Error('The Ledger app did not return to its home screen');
}
