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

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
