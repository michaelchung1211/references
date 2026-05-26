# Getting started (public)

This file lives in `src/public-notes/`. When `npm run encrypt` runs, it'll ask whether `public-notes` should have a password. If you press Enter (no password), this file ends up on GitHub as **plaintext** — anyone with the URL can read it.

## Why have a public project under src/ at all?

So all your "things I want on the site" live in one place (`src/`), and the build CLI handles publishing them. You don't have to remember which files are sensitive and which aren't — the CLI asks per project, once.

## How to make this private later

Delete the corresponding entry in `encrypted/manifest.json` and re-run `npm run encrypt`. You'll be prompted for a password.
