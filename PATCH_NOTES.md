# My Lex Base — v0.28-stable Patch

This patch fixes the *empty directory / documents not loading* regression and implements the v0.28 folding behavior reliably.

## What changed
1. `site/assets/app.js` — rebuilt for stability:
   - Loads `index/tree.json` with fallback to `index/docs.json`.
   - Unifies path handling (always `content/...`).
   - Page TOC folding: default show H1 + only immediate children; reliable toggling even near the tail.
   - Smooth scroll + scroll‑spy with temporary lock.
   - Sidebar gutter drag with width persistence.
   - Mobile TOC compact mode (<=768px).

2. `scripts/build_site.py` — scans **both** `content/` and `site/content/` (former wins), copies into `site/content/`, and generates:
   - `site/index/docs.json`, `site/index/tree.json`,
   - minimal FT index: `route.json`, `shard_all.json`.

3. `.github/workflows/pages.yml` — ensures index files exist even if there is no `content/` yet (prevents blank UI).

## How to apply
- Replace the corresponding files in your repo:
  - `site/assets/app.js`
  - `scripts/build_site.py`
  - `.github/workflows/pages.yml`
- Commit & push to **main**.

## Local build (optional)
```bash
python3 scripts/build_site.py
# then open site/index.html with a static server
```

