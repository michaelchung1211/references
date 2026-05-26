#!/usr/bin/env node
// Build CLI: reads src/, writes encrypted/.
//
// Layout of src/:
//   src/<project>/<...>/<file>.{md,html,pdf,...}
//
// Each top-level subfolder under src/ is a "project". Per project, you set
// either a password (→ files are AES-GCM encrypted with an Argon2id-derived
// key) or no password (→ files are copied to encrypted/<project>/ as plain
// bytes, served on GitHub as plaintext).
//
// The manifest at encrypted/manifest.json is PLAINTEXT — it just lists every
// project, whether it's private, and (for private ones) the per-project salt.
// Passwords never leave your laptop.

import { readdir, readFile, writeFile, mkdir, rm, stat, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { webcrypto as crypto } from 'node:crypto';
import { argon2id } from 'hash-wasm';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC_DIR = path.join(ROOT, 'src');
const OUT_DIR = path.join(ROOT, 'encrypted');
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json');

const VERSION = 0x01;
const ARGON2 = { memorySize: 65536, iterations: 3, parallelism: 1, hashLength: 32 };

// ---------- crypto helpers ----------

function randomBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }

async function deriveKey(password, salt) {
  const raw = await argon2id({ password, salt, ...ARGON2, outputType: 'binary' });
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
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

async function sha256Hex(bytes) {
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- prompt helpers ----------

let pipedLines = null;
async function loadPipedInput() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  pipedLines = Buffer.concat(chunks).toString('utf8').split('\n');
}

function ask(question, { hidden = false } = {}) {
  if (!process.stdin.isTTY) {
    process.stdout.write(question);
    const line = pipedLines.shift() ?? '';
    process.stdout.write(hidden ? '\n' : line + '\n');
    return Promise.resolve(line);
  }
  return new Promise((resolve) => {
    let muted = false;
    const mutableStdout = new Writable({
      write(chunk, enc, cb) { if (!muted) process.stdout.write(chunk, enc); cb(); },
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
    const a = await ask(`  password for "${label}" (empty = public): `, { hidden: true });
    if (a === '') return null; // public
    if (a.length < 8) {
      console.log('  Password must be at least 8 characters (or empty for public). Try again.');
      continue;
    }
    const b = await ask(`  confirm: `, { hidden: true });
    if (a !== b) { console.log('  Did not match. Try again.'); continue; }
    return a;
  }
}

// ---------- fs helpers ----------

async function* walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
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

async function loadPreviousManifest() {
  if (!existsSync(MANIFEST_PATH)) return null;
  try {
    const text = await readFile(MANIFEST_PATH, 'utf8');
    return JSON.parse(text);
  } catch { return null; }
}

async function rmrf(dir) {
  if (!existsSync(dir)) return;
  await rm(dir, { recursive: true, force: true });
}

// ---------- main ----------

async function main() {
  if (!process.stdin.isTTY) await loadPipedInput();

  if (!existsSync(SRC_DIR)) {
    console.error(`No src/ directory found at ${SRC_DIR}.`);
    console.error('Create it and drop files into per-project subfolders, e.g. src/work/notes.md');
    process.exit(1);
  }

  // 1. Gather files, grouped by top-level project name.
  const projects = new Map(); // name -> [{ absPath, relPath }]
  for await (const abs of walk(SRC_DIR)) {
    const rel = path.relative(SRC_DIR, abs).split(path.sep).join('/');
    const segs = rel.split('/');
    if (segs.length < 2) {
      console.warn(`Skipping ${rel} — files must live under a project folder, e.g. src/<project>/${rel}`);
      continue;
    }
    const p = segs[0];
    if (!projects.has(p)) projects.set(p, []);
    projects.get(p).push({ absPath: abs, relPath: rel });
  }

  if (projects.size === 0) {
    console.error('No files found under src/. Add files to per-project folders first.');
    process.exit(1);
  }

  console.log(`Found ${[...projects.values()].reduce((n, a) => n + a.length, 0)} file(s) across ${projects.size} project(s):`);
  for (const [p, files] of projects) console.log(`  - ${p}: ${files.length} file(s)`);
  console.log('');

  // 2. Look at the previous manifest to know which projects were private/public.
  const prev = await loadPreviousManifest();
  const prevByName = new Map();
  if (prev && Array.isArray(prev.projects)) {
    for (const p of prev.projects) prevByName.set(p.name, p);
  }

  // 3. Decide per-project: public or private + password.
  const projectMeta = new Map(); // name -> { private, password?, salt? }
  for (const name of projects.keys()) {
    const prior = prevByName.get(name);
    if (prior && prior.private === false) {
      console.log(`Project "${name}": public (carried over from previous build)`);
      projectMeta.set(name, { private: false });
      continue;
    }
    if (prior && prior.private === true) {
      console.log(`Project "${name}": private. Enter the password to re-encrypt:`);
      let pw;
      while (true) {
        pw = await ask(`  password: `, { hidden: true });
        if (pw.length >= 8) break;
        console.log('  Password must be at least 8 characters.');
      }
      projectMeta.set(name, { private: true, password: pw, salt: Buffer.from(prior.salt, 'base64') });
      continue;
    }
    // New project — ask whether to set a password.
    console.log(`Project "${name}" is new.`);
    const pw = await askPassword(name);
    if (pw === null) {
      projectMeta.set(name, { private: false });
    } else {
      projectMeta.set(name, { private: true, password: pw, salt: randomBytes(16) });
    }
    console.log('');
  }

  // 4. Clear out previous output for projects we're rebuilding, then write fresh.
  for (const name of projects.keys()) {
    await rmrf(path.join(OUT_DIR, name));
  }
  await mkdir(OUT_DIR, { recursive: true });

  const manifest = {
    version: 2,
    kdf: { name: 'argon2id', ...ARGON2 },
    projects: [],
  };

  for (const [name, files] of projects) {
    const meta = projectMeta.get(name);
    const outProjDir = path.join(OUT_DIR, name);
    await mkdir(outProjDir, { recursive: true });

    const projectEntry = { name, private: meta.private, files: [] };

    if (meta.private) {
      const salt = meta.salt instanceof Uint8Array ? meta.salt : new Uint8Array(meta.salt);
      const key = await deriveKey(meta.password, salt);
      projectEntry.salt = Buffer.from(salt).toString('base64');

      for (const { absPath, relPath } of files) {
        const data = new Uint8Array(await readFile(absPath));
        const enc = await encryptBlob(key, data);
        const blobName = (await sha256Hex(enc)).slice(0, 32) + '.enc';
        await writeFile(path.join(outProjDir, blobName), enc);
        const ext = path.extname(relPath);
        projectEntry.files.push({
          path: relPath,
          name: path.basename(relPath),
          blob: `${name}/${blobName}`,
          type: extType(ext),
          ext: ext.replace(/^\./, '').toLowerCase(),
          size: data.byteLength,
        });
        console.log(`  🔒 ${relPath} -> encrypted/${name}/${blobName}`);
      }
    } else {
      // Public: copy bytes verbatim.
      for (const { absPath, relPath } of files) {
        const data = await readFile(absPath);
        const subPath = relPath.split('/').slice(1).join('/'); // strip project name
        const destDir = path.dirname(path.join(outProjDir, subPath));
        await mkdir(destDir, { recursive: true });
        await writeFile(path.join(outProjDir, subPath), data);
        const ext = path.extname(relPath);
        projectEntry.files.push({
          path: relPath,
          name: path.basename(relPath),
          publicHref: `${name}/${subPath}`,
          type: extType(ext),
          ext: ext.replace(/^\./, '').toLowerCase(),
          size: data.byteLength,
        });
        console.log(`  📄 ${relPath} -> encrypted/${name}/${subPath}`);
      }
    }

    projectEntry.files.sort((a, b) => a.path.localeCompare(b.path));
    manifest.projects.push(projectEntry);
  }

  manifest.projects.sort((a, b) => a.name.localeCompare(b.name));

  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\nWrote encrypted/manifest.json (${manifest.projects.length} project(s)).`);

  // 5. Garbage-collect projects that no longer exist in src/.
  if (existsSync(OUT_DIR)) {
    const entries = await readdir(OUT_DIR, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (!projects.has(e.name)) {
        await rmrf(path.join(OUT_DIR, e.name));
        console.log(`  removed stale project: encrypted/${e.name}/`);
      }
    }
  }

  console.log('\nDone. Review the diff, then commit + push.');
}

main().catch((e) => { console.error(e); process.exit(1); });
