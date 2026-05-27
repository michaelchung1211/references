# References

A static site for my personal collection of references (Markdown, HTML, PDF). Hosted on GitHub Pages, with an optional per-project encryption layer for anything sensitive.

Live: <https://ref.ezcoder.ink>

## Stack at a glance

- **Jekyll** (the default GitHub Pages builder). `_config.yml` controls it.
- **Vanilla HTML + ES modules** for the index and viewer — no React, no bundler.
- **`marked` + `DOMPurify`** (loaded from a CDN) for client-side Markdown rendering.
- **Node CLI** (`tools/encrypt.mjs`) for the build-time encryption step. Uses `hash-wasm` for Argon2id and the Web Crypto API for AES-GCM.
- **No server**. Everything is static. The browser does the decryption.

A full architecture walkthrough lives in [architecture.html](architecture.html) (or open `/architecture.html` on the live site). The standalone system diagram is at [diagram.html](diagram.html) — open it and click **Save as PDF** for an offline copy.

## Project layout

```
references/
├── _config.yml             # Jekyll config
├── index.html              # the homepage (Jekyll renders it, then JS hydrates the manifest section)
├── viewer.html             # renders one .md / .pdf / .html / encrypted blob
├── architecture.html       # explainer page: how Pages, rendering, and encryption fit together
├── diagram.html            # standalone printable system diagram (Save-as-PDF button)
├── crypto.js               # browser-side AES-GCM + Argon2id helpers
├── assets/style.css        # styling
├── tools/encrypt.mjs       # Node CLI: reads src/, writes encrypted/
├── src/                    # GITIGNORED. Your plaintext source for the encryption pipeline.
└── encrypted/              # committed output: manifest.json + .enc blobs + public files
```

## Adding files (the encryption pipeline)

All content goes through the `src/ → encrypted/` pipeline. Each top-level folder under `src/` is a **project** with its own decision: set a password (encrypted on GitHub) or leave the password empty (plain bytes on GitHub).

```
src/                       # gitignored, your plaintext source
├── work/                  # password → AES-256-GCM ciphertext on github
│   └── salary.md
├── personal/              # password → AES-256-GCM ciphertext on github
│   └── diary.md
└── public-notes/          # empty password → plain bytes on github
    └── getting-started.md
```

After running the CLI, the committed output looks like:

```
encrypted/
├── manifest.json          # plaintext: lists every project + per-project salts
├── personal/<hash>.enc    # encrypted
├── work/<hash>.enc        # encrypted
└── public-notes/getting-started.md   # plain bytes
```

`src/` itself is gitignored ([.gitignore](.gitignore)) and never committed — only `encrypted/` ships.

### One-time setup

```sh
npm install                # installs hash-wasm for Argon2id
```

### Step-by-step: adding files

1. **Drop the file under a project folder in `src/`.**
   - To extend an existing project: put it under that project, e.g. `src/work/new-notes.md`. It inherits that project's privacy (set when the project was first encrypted).
   - To start a new project: create a new top-level folder, e.g. `src/recipes/sourdough.md`. You'll be prompted for its password the first time you encrypt.
   - Subfolders inside a project are fine. Any extension works (`.md`, `.html`, `.pdf`, …).

2. **Run the CLI from the repo root** (not from inside `src/`). It's per-project — pick which project(s) to (re-)encrypt:
   ```sh
   npm run encrypt                  # interactive: lists projects, prompts which to encrypt
   npm run encrypt -- work          # only re-encrypt the "work" project
   npm run encrypt -- work personal # multiple projects at once
   npm run encrypt -- all           # re-encrypt every project under src/
   ```
   Projects you **don't** select are left completely alone — their `encrypted/<project>/` blobs and manifest entry are preserved verbatim. No password prompt, no blob filename churn, no git diff for those projects.

   The interactive prompt looks like:
   ```
   Found 3 project(s) in src/:
     - personal (private) — 2 file(s)
     - public-notes (public) — 1 file(s)
     - work (private) — 2 file(s)

   Which to encrypt? (comma-separated names, or "all"): work
   ```

   For each project you do select, you'll see:
   - **New project** → prompted for a password.
     - **Press Enter (empty input) to leave it public** — no password needed, files ship as plain bytes.
     - Type a password ≥ 8 chars (confirmed twice) to make it private.
   - **Existing private project** → prompted for the current password to re-encrypt.
   - **Existing public project** → no prompt; files are copied as-is.

3. **Commit and push** the result:
   ```sh
   git add encrypted/
   git commit -m "add new-notes.md under work"
   git push
   ```
   GitHub Pages rebuilds the site within a minute or so.

Markdown files **do not need front matter** — they're rendered client-side by [viewer.html](viewer.html).

### Deleting content

Same workflow, mirrored:

- **Delete one file** → delete it from `src/<project>/<file>`, then `npm run encrypt -- <project>`. You **must select that project** in the encrypt run, otherwise the CLI leaves the project's encrypted/ folder alone and the old blob stays. Every other file in the project gets re-encrypted (new IVs, new blob filenames), so expect a larger git diff for that project.
- **Delete an entire project** → delete the whole `src/<project>/` folder, then run `npm run encrypt` (any invocation — even encrypting an unrelated project). The garbage-collect step at the end removes `encrypted/<project>/` and the project's entry is dropped from the manifest.
- **Delete the last file in a private project but keep the project** → uncommon. Easiest path: delete `src/<project>/` entirely, run encrypt to drop it from the site, then re-create the project later when you have new content.

`encrypted/manifest.json` is rewritten atomically at the end of every encrypt run, so a CLI crash mid-run won't corrupt it. The CLI also verifies your password against an existing blob **before wiping anything**, so a typo on re-encrypt errors out with "Wrong password — try again. (Nothing has been written yet.)" instead of silently destroying old ciphertext.

### Reading content on the site

- **Public projects**: links work straight from the index. Markdown opens in the viewer; PDFs / HTML open directly.
- **Private projects**: the index shows the project with a lock <img src="https://unpkg.com/lucide-static@latest/icons/lock.svg" width="13" alt="lock"> icon. Type the project's password → file list appears → click a file to read.
- Passwords are cached in the tab's `sessionStorage` only. Closing the tab clears them.
- Each unlocked project shows a **Forget password** button that clears just that project's cached password (and re-shows the password form). Other unlocked projects stay open.

### Threat model

- <img src="https://unpkg.com/lucide-static@latest/icons/check.svg" width="14" alt="yes"> Without a password, a private project is just ciphertext on a public URL.
- <img src="https://unpkg.com/lucide-static@latest/icons/check.svg" width="14" alt="yes"> Argon2id (m=64 MB, t=3, p=1) makes offline brute-force expensive.
- <img src="https://unpkg.com/lucide-static@latest/icons/x.svg" width="14" alt="no"> Cannot hide that *some* encrypted content exists, the number of files, project names, or approximate sizes.
- <img src="https://unpkg.com/lucide-static@latest/icons/x.svg" width="14" alt="no"> Cannot help if your password is weak / leaked / your device is compromised.

### Rotating a password / changing privacy

- **Rotate**: delete the project's folder from `encrypted/` and re-run `npm run encrypt`. You'll be prompted for the new password (treated as a new project).
- **Make public**: edit `encrypted/manifest.json`, set `"private": false` for that project, delete its `.enc` blobs, re-run. (Or just delete the project entry entirely and re-run.)
- **Make private**: delete that project's entry from `encrypted/manifest.json` and re-run; you'll be prompted to set a password.

## Legacy: plaintext topic folders

The site also still walks any plaintext `.md`, `.html`, `.htm`, `.pdf` files in top-level folders at the repo root (outside `encrypted/`). Drop files into a topic folder like `git/` or `databases/` and they'll appear in the index automatically. This route is committed as-is and bypasses the encryption pipeline.

## Enabling GitHub Pages

In the repo settings → **Pages**:

- **Source**: Deploy from a branch
- **Branch**: `main` / `/ (root)`

The site rebuilds automatically on push.

## Local preview

```sh
bundle install
bundle exec jekyll serve
```

Then open <http://localhost:4000/>.

## How it works (one-pager)

For a fuller walkthrough see [architecture.html](architecture.html). Short version:

- `_config.yml` — Jekyll config. Excludes `src/`, `tools/`, `node_modules/`, the README, etc. so they aren't published.
- `index.html` — has Jekyll front matter (`layout: null`) so Jekyll passes it through as-is. The Liquid block on top walks `site.static_files` to render any legacy plaintext topic folders. The `<script type="module">` block at the bottom fetches `encrypted/manifest.json` and hydrates a section per project (with a password form for private ones).
- `viewer.html` — renders one file. If the URL has `?path=…` it's plaintext; if it has `?blob=…&project=…` it fetches the encrypted blob, derives the key via Argon2id, decrypts via AES-GCM, then renders.
- `crypto.js` — shared AES-GCM + Argon2id helpers used by index + viewer. Mirrors what `tools/encrypt.mjs` does on the write side.
- `tools/encrypt.mjs` — Node CLI. Reads `src/`, prompts per project, writes `encrypted/manifest.json` + per-project `.enc` blobs (or plain files for public projects).
- `assets/style.css` — styling.

PDFs and HTML files link directly (the browser handles them). Markdown is routed through the viewer.
