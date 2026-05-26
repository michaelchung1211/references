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

## Encrypted references

Anything sensitive can be encrypted before being committed. Ciphertext lives in `encrypted/` and is served by GitHub Pages; the password lives only in your head. Decryption happens entirely in the browser via Web Crypto (AES-256-GCM) with Argon2id key derivation.

### Threat model

- ✅ Protects the contents against anyone who clones the repo or hits the public URL without the password.
- ✅ Argon2id (m=64MB, t=3, p=1) makes offline brute-force expensive.
- ❌ Cannot hide that *some* encrypted content exists, the number of files, or their approximate sizes.
- ❌ Cannot help if your password is weak, leaked, or your device is compromised.

### Adding an encrypted file

1. Drop it into `_plaintext/<group>/...`. The top-level folder is the "group" — every file in the same group shares one password.
   ```
   _plaintext/
     work/
       salary-notes.md
       offer.pdf
     personal/
       diary.md
   ```
   `_plaintext/` is gitignored — it never leaves your machine.

2. Install the CLI's one dependency (once):
   ```sh
   npm install
   ```

3. Run the encryptor:
   ```sh
   npm run encrypt
   ```
   You'll be prompted for:
   - A **master password** (unlocks the manifest = list of folders + filenames).
   - One **password per group** (unlocks the files in that group).

4. It writes `encrypted/manifest.enc` + `encrypted/blobs/<hash>.enc`. Commit + push as usual.

### Reading encrypted files

1. Visit the site.
2. Scroll to the "Locked" section, enter the master password to reveal the file list.
3. Click a file. The viewer prompts for that file's group password and decrypts in-browser.
4. Passwords are cached in `sessionStorage` for the current tab only — close the tab and they're gone.

### Rotating a password

Delete `encrypted/` and re-run `npm run encrypt`. You'll be prompted for the new passwords, and all files are re-encrypted.
