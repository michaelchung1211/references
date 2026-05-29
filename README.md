# References

A static site for my personal collection of references (Markdown, HTML, PDF). Hosted on GitHub Pages, with an optional per-project encryption layer for anything sensitive.

Live: <https://ref.ezcoder.ink>

## Stack at a glance

- **Jekyll** (the default GitHub Pages builder). `_config.yml` controls it.
- **Vanilla HTML + ES modules** for the index and viewer — no React, no bundler.
- **`marked` + `DOMPurify`** (loaded from a CDN) for client-side Markdown rendering.
- **Node CLI** (`tools/encrypt.mjs`) for the build-time encryption step. Uses `hash-wasm` for Argon2id and the Web Crypto API for AES-GCM.
- **No server**. Everything is static. The browser does the decryption.

A full architecture walkthrough lives in [architecture.html](architecture.html) (or open `/architecture.html` on the live site). The big colored picture at the top of that page is [assets/system-diagram.svg](assets/system-diagram.svg) — open it directly to view it standalone.

## Project layout

```
references/
├── _config.yml             # Jekyll config
├── index.html              # the homepage (Jekyll renders it, then JS hydrates the manifest section)
├── 404.html                # SPA-style redirect for clean project URLs (e.g. /companion)
├── viewer.html             # renders one .md (HTML/PDF blobs go full-page via blob URL)
├── architecture.html       # explainer page: how Pages, rendering, and encryption fit together
├── assets/system-diagram.svg  # the colored system diagram embedded at the top of architecture.html
├── crypto.js               # browser-side AES-GCM + Argon2id helpers
├── assets/style.css        # styling
├── tools/encrypt.mjs       # Node CLI: reads src/ (incl. optional config.json), writes encrypted/
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

### Per-project metadata (`config.json`)

Each project can have an optional `src/<project>/config.json` carrying display metadata:

```json
{
  "title": "Companion Studio",
  "hint": "starts with m, 8 chars"
}
```

Both fields are optional. The CLI treats `config.json` as metadata, not content — it's never encrypted or copied to `encrypted/`.

- **`title`** — human-readable name shown in place of the raw folder name. On the home page the title (if set) replaces the folder name in the section header. On the project's own page (`/<folder>`) the title is shown big and the folder name appears as a small uppercase subtitle beneath it.
- **`hint`** — only meaningful for **private** projects. At build time it's encrypted with a key derived from the magic word `"hint"` + the project's salt, and stored in `encrypted/manifest.json` as `hintBlob`. The visitor reveals it by typing `hint` as the password — the plaintext hint never sits in the page DOM beforehand. See [the threat model](#threat-model) for the security ceiling here.

Editing `config.json` does **not** require re-entering the file password. `npm run encrypt` refreshes title/hint for every project on every run — even ones you didn't select for re-encryption — because the hint cipher only needs the magic word + existing salt, not the file password. Only changes to file content under the project need a full re-encrypt with the password.

If a public project specifies a `hint`, the CLI warns and ignores it (there's no password to hint at).

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

### Clean project URLs (`/<project>`)

Visiting `https://ref.ezcoder.ink/companion` shows only the `companion` project — no home-page chrome (header + footer are hidden), folder name displayed as a subtitle under the configured title. Mechanism (GitHub Pages doesn't do real server-side routing):

1. The browser asks for `/companion`, GitHub Pages can't find a file → serves `404.html` with HTTP 404.
2. `404.html` stashes the requested path in `sessionStorage` and bounces to `/`.
3. `index.html` reads the stash, calls `history.replaceState` to restore `/companion` in the address bar, and the router filters the section list to just that project.
4. An unknown path (e.g. `/typo`) still ends up at `index.html` but the router shows an inline "Project not found" notice.

The same matcher is used for plaintext topic folders (e.g. `/git`) — both come from `data-project-name` on each `<section>`.

### Viewer behavior (no frames)

The viewer renders files **full-page**, no iframes:

- **Markdown** (encrypted or plaintext): rendered into the body, centered at 760px — no header, no back link. Browser tab title shows the filename.
- **PDF**: viewer decrypts the bytes, wraps them in a `blob:` URL, then `location.replace()` — the browser's native PDF viewer takes over the whole tab.
- **HTML**: same `location.replace(blobUrl)` flow, so the HTML is rendered as the whole page with its full document context (scripts/styles run normally — flagged because the old version sandboxed it). The browser back button returns you to the project page in one press.

### Revealing the hint

Inside any private project's password form, typing `hint` short-circuits the unlock and reveals the project's hint instead. The text is decrypted client-side from `hintBlob` and inserted below the form on-demand — the hint is **not** rendered into the DOM before that. If the project has no hint in `config.json`, the form shows "No hint is set for this project." See [Per-project metadata](#per-project-metadata-configjson).

### Threat model

- <img src="https://unpkg.com/lucide-static@latest/icons/check.svg" width="14" alt="yes"> Without a password, a private project is just ciphertext on a public URL.
- <img src="https://unpkg.com/lucide-static@latest/icons/check.svg" width="14" alt="yes"> Argon2id (m=64 MB, t=3, p=1) makes offline brute-force expensive.
- <img src="https://unpkg.com/lucide-static@latest/icons/x.svg" width="14" alt="no"> Cannot hide that *some* encrypted content exists, the number of files, project names, or approximate sizes.
- <img src="https://unpkg.com/lucide-static@latest/icons/x.svg" width="14" alt="no"> Cannot help if your password is weak / leaked / your device is compromised.

**Hint reveal (`config.json` → `hint`)** has a softer guarantee than file encryption:

- <img src="https://unpkg.com/lucide-static@latest/icons/check.svg" width="14" alt="yes"> Not in the page DOM until the magic word is typed (Inspect Element reveals nothing).
- <img src="https://unpkg.com/lucide-static@latest/icons/check.svg" width="14" alt="yes"> Not in `manifest.json` plaintext — only `hintBlob` ciphertext.
- <img src="https://unpkg.com/lucide-static@latest/icons/x.svg" width="14" alt="no"> Defeatable by reading [index.html](index.html) to find the magic word `"hint"`, then re-running Argon2id + AES-GCM against the manifest's `hintBlob` + `salt`. On pure static GitHub Pages, the magic word is a shared secret embedded in your JS — this is the ceiling. Going further would require an off-static rate-limited endpoint.

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
- `index.html` — has Jekyll front matter (`layout: null`) so Jekyll passes it through as-is. Three things happen here, in order:
  1. An inline script restores the URL from `sessionStorage` if we arrived via `404.html` (clean-URL routing).
  2. The Liquid block walks `site.static_files` to render any legacy plaintext topic folders, tagging each `<section>` with `data-project-name`.
  3. The `<script type="module">` block fetches `encrypted/manifest.json`, hydrates a section per project (using `project.title` if set; password form for private ones), then runs the path router to filter to a single project on `/<name>`.
- `404.html` — minimal page Jekyll generates for unknown URLs. Captures the requested path into `sessionStorage` and bounces to `/` so the router can pick it up. Without this, GitHub Pages couldn't deliver `/<project>` URLs at all.
- `viewer.html` — renders Markdown (plaintext or decrypted) inline, centered, with no chrome. For decrypted PDF / HTML it builds a `blob:` URL and calls `location.replace()`, handing the browser a full-page view of the file.
- `crypto.js` — shared AES-GCM + Argon2id helpers used by index + viewer. Mirrors what `tools/encrypt.mjs` does on the write side. The hint reveal uses the same `deriveKey` / `decryptBlob` primitives, just with the magic word `"hint"` as the input password.
- `tools/encrypt.mjs` — Node CLI. Reads `src/` (pulling each `config.json` aside as metadata), prompts per project, writes `encrypted/manifest.json` (with `title` plain and `hintBlob` ciphertext per project) + per-project `.enc` blobs (or plain files for public projects). Title/hint refresh runs for every project on every build, no password needed for that.
- `assets/style.css` — styling. The per-project view's title is promoted to a big headline via `section[data-route-active="single"] > h2`.

PDFs and HTML files link directly (the browser handles them). Markdown is routed through the viewer.
