# References

A static site for my collection of references (Markdown, HTML, PDF), hosted on GitHub Pages.

Live: <https://michaelchung1211.github.io/references/>

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

Then open <http://localhost:4000/references/>.

## How it works

- `_config.yml` — Jekyll configuration.
- `index.html` — auto-generated index that walks `site.static_files` and groups them by top-level folder (the "topic").
- `viewer.html` — client-side Markdown renderer (marked + DOMPurify) so `.md` files don't need front matter.
- `assets/style.css` — styling.

PDFs and HTML files link directly (the browser handles them). Markdown is routed through the viewer.
