// Browser-side crypto helpers for the encrypted-references system.
//
// File format:
//   encrypted/<project>/<hash>.enc : [ver=1][iv:12][AES-GCM ciphertext + tag]
//
// Per-project salt lives in encrypted/manifest.json (plaintext — no master
// password). Argon2id derives a key from (password, salt).

import { argon2id } from 'https://esm.sh/hash-wasm@4.11.0';

export const VERSION = 0x01;
export const ARGON2 = Object.freeze({
  memorySize: 65536,
  iterations: 3,
  parallelism: 1,
  hashLength: 32,
});

const subtle = globalThis.crypto.subtle;

export async function deriveKey(password, salt) {
  const raw = await argon2id({
    password,
    salt,
    ...ARGON2,
    outputType: 'binary',
  });
  return subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function decryptBlob(key, blob) {
  if (blob[0] !== VERSION) throw new Error('Unknown blob version: ' + blob[0]);
  const iv = blob.subarray(1, 13);
  const ct = blob.subarray(13);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new Uint8Array(pt);
}

export function utf8Decode(b) { return new TextDecoder().decode(b); }

export function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
