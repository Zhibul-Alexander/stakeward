/**
 * Strict base64 for wire transactions. Kit's base64 codec is not used here: its workerd/node build calls Buffer,
 * which workerd only has with nodejs_compat.
 */

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Decodes canonical base64 (standard alphabet, padded); null for anything else, including non-zero padding bits. */
export function decodeBase64(text: string): Uint8Array | null {
  if (text.length % 4 !== 0 || !BASE64.test(text)) return null;
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return encodeBase64(bytes) === text ? bytes : null;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * True exactly when `decodeBase64(text)` is not null, without decoding: the monitor checks every account of a
 * getMultipleAccounts answer and decodes only the few that changed (CPU, DECISIONS.md D49). Canonical means the
 * standard alphabet, padded to a multiple of 4, and zero bits under the padding.
 */
export function isCanonicalBase64(text: string): boolean {
  if (text.length % 4 !== 0 || !BASE64.test(text)) return false;
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  if (padding === 0) return true;
  // The last data character carries 4 (one '=') or 2 (two '=') bits of the final byte and 2 or 4 unused bits.
  const last = ALPHABET.indexOf(text.charAt(text.length - padding - 1));
  return (last & (padding === 2 ? 0x0f : 0x03)) === 0;
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
