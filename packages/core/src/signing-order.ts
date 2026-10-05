import type { Address } from '@solana/kit';

/**
 * Who signs a round next, as a pure rule (CLAUDE.md section 6): first the wallet that may append a Lighthouse tail,
 * while the transactions are still unsigned (a tail added after another signature breaks it); then the fee payer; then
 * the rest in message order.
 *
 * 1. `missing` = `required` minus `present`, in the same order.
 * 2. If `first` is missing, it goes first ("Start again with <wallet> signing first").
 * 3. Only while nothing is signed yet (`present` empty): the missing signers whose wallet appends a tail come next,
 *    the fee payer first among them, then message order.
 * 4. Then the fee payer, if it is still missing.
 * 5. Then the rest, in message order. No address appears twice.
 */
export function signingOrder(input: {
  /** Union of required signers of the round, in message order (fee payer first). */
  required: readonly Address[];
  /** Signers whose signature is already present in EVERY transaction of the round. */
  present: readonly Address[];
  feePayer: Address;
  /** True when that signer's wallet may append a Lighthouse tail (site rule, see signing/rules.ts). */
  appendsTail: (signer: Address) => boolean;
  /** "Start again with <wallet> signing first". */
  first?: Address | null;
}): Address[] {
  const missing = input.required.filter((signer) => !input.present.includes(signer));
  const order: Address[] = [];
  const add = (signer: Address) => {
    if (missing.includes(signer) && !order.includes(signer)) order.push(signer);
  };

  if (input.first !== undefined && input.first !== null) add(input.first);
  if (input.present.length === 0) {
    const tailFirst = missing.filter((signer) => input.appendsTail(signer));
    if (tailFirst.includes(input.feePayer)) add(input.feePayer);
    tailFirst.forEach(add);
  }
  add(input.feePayer);
  missing.forEach(add);
  return order;
}
