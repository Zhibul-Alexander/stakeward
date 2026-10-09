// Test keys for the gate on devnet and mainnet, stored as solana-keygen JSON files (64 numbers: secret seed, then
// public key) in the git-ignored .keys/ directory. Scripts-only code: the product never sees a private key.
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createKeyPairSignerFromBytes, type KeyPairSigner } from '@solana/kit';

export const KEYS_DIR = new URL('../../.keys/', import.meta.url);

export function keyPath(name: string): URL {
  return new URL(`${name}.json`, KEYS_DIR);
}

/** The repository-relative path shown to the user, e.g. `.keys/devnet-funder.json`. */
export function keyDisplayPath(name: string): string {
  return `.keys/${name}.json`;
}

export async function loadKey(name: string): Promise<KeyPairSigner | null> {
  const path = keyPath(name);
  if (!existsSync(path)) return null;
  const bytes: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(bytes) || bytes.length !== 64 || !bytes.every((b) => Number.isInteger(b) && b >= 0 && b < 256)) {
    throw new Error(`${keyDisplayPath(name)} is not a solana-keygen key file`);
  }
  return createKeyPairSignerFromBytes(Uint8Array.from(bytes as number[]));
}

/** Generates a new key and writes it to `.keys/<name>.json`, replacing the file when `replace` is set. */
export async function createKey(name: string, { replace }: { replace: boolean }): Promise<KeyPairSigner> {
  const jwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
  if (jwk.d === undefined || jwk.x === undefined) throw new Error('Ed25519 key export failed');
  const bytes = Uint8Array.from([...Buffer.from(jwk.d, 'base64url'), ...Buffer.from(jwk.x, 'base64url')]);
  const signer = await createKeyPairSignerFromBytes(bytes); // checks that the public half matches the seed
  mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(keyPath(name), JSON.stringify([...bytes]) + '\n', { mode: 0o600, flag: replace ? 'w' : 'wx' });
  return signer;
}

export async function loadOrCreateKey(name: string): Promise<{ signer: KeyPairSigner; created: boolean }> {
  const existing = await loadKey(name);
  if (existing !== null) return { signer: existing, created: false };
  return { signer: await createKey(name, { replace: false }), created: true };
}

/** Keeps a key file that may still control funds under a new name, `<name>.<suffix>.json`. */
export function archiveKey(name: string, suffix: string): string {
  const target = `${name}.${suffix}`;
  renameSync(keyPath(name), keyPath(target));
  return keyDisplayPath(target);
}
