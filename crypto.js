// Browser-side crypto helpers for the encrypted-references system.
//
// Wire format (binary):
//   manifest.enc  : [ver=1][salt:16][iv:12][AES-GCM ciphertext + tag]
//   blobs/*.enc   : [ver=1][iv:12][AES-GCM ciphertext + tag]   (group salt lives in manifest)
//
// KDF: Argon2id with the params below. Bump VERSION if you change them.

import { argon2id } from 'https://esm.sh/hash-wasm@4.11.0';

export const VERSION = 0x01;
export const ARGON2 = Object.freeze({
  memorySize: 65536, // KB
  iterations: 3,
  parallelism: 1,
  hashLength: 32,
});

const subtle = globalThis.crypto.subtle;

export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export async function deriveKey(password, salt) {
  const raw = await argon2id({
    password,
    salt,
    ...ARGON2,
    outputType: 'binary',
  });
  return subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptManifest(password, plaintextBytes) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintextBytes));
  const out = new Uint8Array(1 + 16 + 12 + ct.byteLength);
  out[0] = VERSION;
  out.set(salt, 1);
  out.set(iv, 17);
  out.set(ct, 29);
  return out;
}

export async function decryptManifest(password, blob) {
  if (blob[0] !== VERSION) throw new Error('Unknown manifest version: ' + blob[0]);
  const salt = blob.subarray(1, 17);
  const iv = blob.subarray(17, 29);
  const ct = blob.subarray(29);
  const key = await deriveKey(password, salt);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return { key, plaintext: new Uint8Array(pt), salt };
}

export async function encryptBlob(key, plaintextBytes) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintextBytes));
  const out = new Uint8Array(1 + 12 + ct.byteLength);
  out[0] = VERSION;
  out.set(iv, 1);
  out.set(ct, 13);
  return out;
}

export async function decryptBlob(key, blob) {
  if (blob[0] !== VERSION) throw new Error('Unknown blob version: ' + blob[0]);
  const iv = blob.subarray(1, 13);
  const ct = blob.subarray(13);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new Uint8Array(pt);
}

export function utf8Encode(s) { return new TextEncoder().encode(s); }
export function utf8Decode(b) { return new TextDecoder().decode(b); }

export function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
export function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
