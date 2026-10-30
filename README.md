# chasearenella.com

A field guide: short reference pages on decision-making, systems thinking, and AI-augmented leadership. Served by GitHub Pages from `main`.

## How it works

- `content/pages/*.json` is one guide per file. `content/site.json` holds the site name and outbound links.
- `node scripts/build.js` renders the HTML at `/<slug>/`, plus the home, about, and 404 pages, `sitemap.xml`, and `robots.txt`. The output is committed.
- `.github/workflows/write-page.yml` runs every Monday at 07:00 UTC. It writes the next topic from `content/queue.json` with `scripts/write-page.js`, rebuilds the site, and opens a PR to review.

## Rules every page must pass

`scripts/lib/content.js` enforces these, and the build refuses to run if any page breaks them:

- The site uses only the name "Chase Arenella" (and the handle ChaseOfSpadez). No other name variants.
- No LinkedIn links, photos, or personal details.
- Inline HTML is limited to `strong`, `em`, `br`, and links.

## Setup

- Repo secret `ANTHROPIC_API_KEY`.
- Settings → Actions → General → Workflow permissions: allow GitHub Actions to create pull requests.
