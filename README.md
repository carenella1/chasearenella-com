# chasearenella.com

A field guide: short reference pages on decision-making, systems thinking, and AI-augmented leadership. Served by GitHub Pages from `main`.

## How it works

- `content/pages/*.json` is one guide per file. `content/site.json` holds the site name and outbound links.
- `npm ci`, then `node scripts/build.js`, renders the HTML at `/<slug>/`, plus the home, about, and 404 pages, `sitemap.xml` (with image entries), `robots.txt`, and `guides.json`. The output is committed.
- Each guide gets a 1200×630 title card at `assets/images/chase-arenella-<slug>.png` (`scripts/lib/cards.js`): text plus a network pattern seeded by the slug, rendered with the OFL fonts in `scripts/fonts/`. It's the page image, the link-preview image, and the image in the sitemap.
- `guides.json` lists each guide with the main-site essay it builds on. The main site reads it to link each essay back to its guides.
- `.github/workflows/write-page.yml` runs every Monday at 07:00 UTC. It writes the next topic from `content/queue.json` with `scripts/write-page.js`, rebuilds the site, and opens a PR to review.
- `.github/workflows/auto-merge.yml` merges that PR once it's 72 hours old, unless it has the `hold` label or a changes-requested review.
- `.github/workflows/search-ping.yml` runs after each change to `main`. It waits for the deploy, then submits the sitemap's URLs to IndexNow (`scripts/ping-search-engines.js`; the key file is the `.txt` at the root).

## Rules every page must pass

`scripts/lib/content.js` enforces these, and the build refuses to run if any page breaks them:

- The site uses only the name "Chase Arenella" (and the handle ChaseOfSpadez). No other name variants.
- No LinkedIn links, photos, or personal details.
- Inline HTML is limited to `strong`, `em`, `br`, and links.

## Setup

- Repo secret `ANTHROPIC_API_KEY`.
- Settings → Actions → General → Workflow permissions: allow GitHub Actions to create pull requests.
