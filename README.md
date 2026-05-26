# References

A static site for my collection of references (Markdown, HTML, PDF), hosted on GitHub Pages.

Live: <https://ref.ezcoder.ink>

## Adding files

1. Pick or create a topic folder, e.g. `react/`, `databases/`, `system-design/`.
2. Drop `.md`, `.html`, or `.pdf` files into it. Multiple at once is fine.
3. Commit and push — the index updates on the next deploy.

Markdown files **do not need front matter**. They're rendered client-side by `viewer.html`.

## Enabling GitHub Pages

In the repo settings → **Pages**:

- **Source**: Deploy from a branch
- **Branch**: `main` / `/ (root)`

The site builds automatically on push.

## Local preview

```sh
bundle install
bundle exec jekyll serve
```

Then open <http://localhost:4000/>.

## How it works

- `_config.yml` — Jekyll configuration.
- `index.html` — auto-generated index that walks `site.static_files` and groups them by top-level folder (the "topic"). Also renders the "Locked" section for encrypted files.
- `viewer.html` — client-side Markdown renderer (marked + DOMPurify) so `.md` files don't need front matter. Also handles decrypting encrypted blobs.
- `crypto.js` — shared AES-GCM + Argon2id helpers used by the index and viewer.
- `assets/style.css` — styling.

PDFs and HTML files link directly (the browser handles them). Markdown is routed through the viewer.

## src/ workflow (per-project, optional encryption)

`src/` is the staging area for content the build CLI publishes to the site. Each top-level folder under `src/` is a **project** with its own decision: set a password (→ encrypted on GitHub) or leave it empty (→ plaintext on GitHub).

```
src/                       # gitignored, your plaintext source
├── work/                  # password → AES-256-GCM ciphertext on github
│   └── salary.md
├── personal/              # password → AES-256-GCM ciphertext on github
│   └── diary.md
└── public-notes/          # no password → plain bytes on github
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

### One-time setup

```sh
npm install                # installs hash-wasm for Argon2id
```

### Adding / updating content

1. Drop or edit files under `src/<project>/`.
2. Run `npm run encrypt`.
   - **New project**: you're asked for a password. **Press Enter to make it public** (no encryption).
   - **Existing private project**: you're asked for the current password to re-encrypt.
   - **Existing public project**: no prompt; files are copied as-is.
3. Commit `encrypted/` and push.

### Reading content

- **Public projects**: links work straight from the index.
- **Private projects**: the index shows the project with a 🔒. Type the project's password → file list appears → click a file to read.
- Passwords are cached in the tab's `sessionStorage` only. Closing the tab clears them.

### Threat model

- ✅ Without a password, a private project is just ciphertext on a public URL.
- ✅ Argon2id (m=64 MB, t=3, p=1) makes offline brute-force expensive.
- ❌ Cannot hide that *some* encrypted content exists, the number of files, project names, or approximate sizes.
- ❌ Cannot help if your password is weak / leaked / your device is compromised.

### Rotating a password / changing privacy

- **Rotate**: delete the project's folder from `encrypted/` and re-run `npm run encrypt`. You'll be prompted for the new password.
- **Make public**: edit `encrypted/manifest.json`, set `"private": false`, delete the `.enc` blobs, re-run. (Or just delete the project entry entirely and re-run.)
- **Make private**: delete that project's entry from `encrypted/manifest.json` and re-run; you'll be prompted to set a password.
