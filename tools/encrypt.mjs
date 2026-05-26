#!/usr/bin/env node
// Build-time CLI: reads _plaintext/, writes encrypted/ (manifest + blobs).
//
// Usage:
//   node tools/encrypt.mjs
//
// Layout of _plaintext/:
//   _plaintext/<group>/<...>/<file>.{md,html,pdf,...}
//
// Each top-level folder under _plaintext/ is one "group". You'll be prompted
// for one password per group, plus a master password for the manifest.

import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { webcrypto as crypto } from 'node:crypto';
import { argon2id } from 'hash-wasm';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PLAIN_DIR = path.join(ROOT, '_plaintext');
const ENC_DIR = path.join(ROOT, 'encrypted');
const BLOBS_DIR = path.join(ENC_DIR, 'blobs');

const VERSION = 0x01;
const ARGON2 = { memorySize: 65536, iterations: 3, parallelism: 1, hashLength: 32 };

// ---------- file-format helpers (mirror of crypto.js) ----------

function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

async function deriveKey(password, salt) {
  const raw = await argon2id({
    password,
    salt,
    ...ARGON2,
    outputType: 'binary',
  });
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptManifest(password, plaintext) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  const out = new Uint8Array(1 + 16 + 12 + ct.byteLength);
  out[0] = VERSION;
  out.set(salt, 1);
  out.set(iv, 17);
  out.set(ct, 29);
  return out;
}

async function encryptBlob(key, plaintext) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  const out = new Uint8Array(1 + 12 + ct.byteLength);
  out[0] = VERSION;
  out.set(iv, 1);
  out.set(ct, 13);
  return out;
}

// ---------- prompt helpers ----------

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    let muted = false;
    const mutableStdout = new Writable({
      write(chunk, encoding, cb) {
        if (!muted) process.stdout.write(chunk, encoding);
        cb();
      },
    });
    const rl = readline.createInterface({ input: process.stdin, output: mutableStdout, terminal: true });
    rl.question(question, (answer) => {
      if (hidden) process.stdout.write('\n');
      rl.close();
      resolve(answer);
    });
    if (hidden) muted = true;
  });
}

async function askPassword(label) {
  while (true) {
    const a = await ask(`  ${label}: `, { hidden: true });
    if (a.length < 8) {
      console.log('  Password must be at least 8 characters. Try again.');
      continue;
    }
    const b = await ask(`  ${label} (confirm): `, { hidden: true });
    if (a !== b) {
      console.log('  Passwords did not match. Try again.');
      continue;
    }
    return a;
  }
}

// ---------- fs helpers ----------

async function* walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function extType(ext) {
  const e = ext.toLowerCase().replace(/^\./, '');
  if (e === 'md' || e === 'markdown') return 'md';
  if (e === 'pdf') return 'pdf';
  if (e === 'html' || e === 'htm') return 'html';
  return e || 'bin';
}

async function sha256Hex(bytes) {
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- main ----------

async function main() {
  if (!existsSync(PLAIN_DIR)) {
    console.error(`No _plaintext/ directory found at ${PLAIN_DIR}.`);
    console.error('Create it and drop files into per-group subfolders, e.g. _plaintext/work/notes.md');
    process.exit(1);
  }

  // 1. Gather files, grouped by top-level subfolder.
  const groups = new Map(); // group -> [{ absPath, relPath }]
  for await (const abs of walk(PLAIN_DIR)) {
    const rel = path.relative(PLAIN_DIR, abs).split(path.sep).join('/');
    const segs = rel.split('/');
    if (segs.length < 2) {
      console.warn(`Skipping ${rel} — files must live under a group folder, e.g. _plaintext/<group>/${rel}`);
      continue;
    }
    const group = segs[0];
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({ absPath: abs, relPath: rel });
  }

  if (groups.size === 0) {
    console.error('No files found under _plaintext/. Add files to per-group folders first.');
    process.exit(1);
  }

  console.log(`Found ${[...groups.values()].reduce((n, a) => n + a.length, 0)} file(s) across ${groups.size} group(s):`);
  for (const [g, files] of groups) console.log(`  - ${g}: ${files.length} file(s)`);
  console.log('');

  // 2. Prompt for passwords.
  console.log('Master password (unlocks the manifest = list of folders/filenames):');
  const masterPw = await askPassword('master');
  console.log('');

  const groupPasswords = new Map();
  for (const g of groups.keys()) {
    console.log(`Group "${g}":`);
    groupPasswords.set(g, await askPassword(g));
    console.log('');
  }

  // 3. Derive group salts + keys.
  await mkdir(BLOBS_DIR, { recursive: true });
  const manifest = {
    version: 1,
    kdf: { name: 'argon2id', ...ARGON2 },
    groups: {},
    files: [],
  };

  for (const [g, files] of groups) {
    const salt = randomBytes(16);
    const key = await deriveKey(groupPasswords.get(g), salt);
    manifest.groups[g] = { salt: Buffer.from(salt).toString('base64') };

    for (const { absPath, relPath } of files) {
      const data = new Uint8Array(await readFile(absPath));
      const enc = await encryptBlob(key, data);
      const blobName = (await sha256Hex(enc)).slice(0, 32) + '.enc';
      await writeFile(path.join(BLOBS_DIR, blobName), enc);

      const ext = path.extname(relPath);
      manifest.files.push({
        path: relPath,
        name: path.basename(relPath),
        blob: blobName,
        group: g,
        type: extType(ext),
        ext: ext.replace(/^\./, '').toLowerCase(),
        size: data.byteLength,
      });
      console.log(`  + ${relPath}  ->  blobs/${blobName}`);
    }
  }

  manifest.files.sort((a, b) => a.path.localeCompare(b.path));

  // 4. Encrypt manifest with master password.
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const manifestEnc = await encryptManifest(masterPw, manifestBytes);
  await writeFile(path.join(ENC_DIR, 'manifest.enc'), manifestEnc);
  console.log(`\nWrote encrypted/manifest.enc (${manifestEnc.byteLength} bytes)`);

  // 5. Clean up orphaned blobs from previous builds.
  const liveBlobs = new Set(manifest.files.map((f) => f.blob));
  const existing = await readdir(BLOBS_DIR);
  let removed = 0;
  for (const name of existing) {
    if (!name.endsWith('.enc')) continue;
    if (!liveBlobs.has(name)) {
      const { rm } = await import('node:fs/promises');
      await rm(path.join(BLOBS_DIR, name));
      removed++;
    }
  }
  if (removed) console.log(`Removed ${removed} orphan blob(s).`);

  console.log('\nDone. Review the diff, then commit + push.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
