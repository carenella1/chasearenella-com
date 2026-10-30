// Renders the whole site from content/: the home page, one page per guide at
// /<slug>/, the about page, 404, sitemap.xml and robots.txt. Output is
// committed and served as-is by GitHub Pages.
//
// Run: node scripts/build.js
const fs = require("fs");
const path = require("path");
const { ROOT, readJson, loadPages, bodyText, wordCount, checkPage } = require("./lib/content");

const site = readJson(path.join(ROOT, "content", "site.json"));
const PERSON_ID = `${site.url}/#person`;
const WEBSITE_ID = `${site.url}/#website`;
const RESERVED = new Set(["about", "assets", "content", "scripts"]);

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function pageUrl(slug) {
  return `${site.url}/${slug}/`;
}

function personNode() {
  return {
    "@type": "Person",
    "@id": PERSON_ID,
    name: site.name,
    alternateName: site.alternateNames,
    url: `${site.url}/`,
    sameAs: site.sameAs,
    description: site.personDescription,
  };
}

function websiteNode() {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: `${site.url}/`,
    name: site.siteName,
    publisher: { "@id": PERSON_ID },
    inLanguage: "en-US",
  };
}

function breadcrumbs(items) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, url], i) => ({ "@type": "ListItem", position: i + 1, name, item: url })),
  };
}

function layout({ title, description, canonical, schema, body, ogType = "website" }) {
  const graph = JSON.stringify({ "@context": "https://schema.org", "@graph": schema }, null, 2);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="${esc(site.siteName)}">
<meta name="twitter:card" content="summary">
<link rel="stylesheet" href="/assets/style.css">
<script type="application/ld+json">
${graph}
</script>
</head>
<body>
<header class="site-header">
  <div class="wrap header-row">
    <a class="brand" href="/">${esc(site.name)}<span>Field Guide</span></a>
    <nav aria-label="Main">
      <a href="/#guides">Guides</a>
      <a href="/about/">About</a>
    </nav>
  </div>
</header>
<main class="wrap">
${body}
</main>
<footer class="site-footer">
  <div class="wrap">
    <p>${esc(site.tagline)}</p>
    <p class="elsewhere">${site.elsewhere.map((e) => `<a href="${e.href}" rel="noopener">${esc(e.label)}</a>`).join(" · ")}</p>
    <p>© ${new Date().getFullYear()} ${esc(site.name)}</p>
  </div>
</footer>
</body>
</html>
`;
}

function formatDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

function renderSection(s) {
  const paras = s.paragraphs.map((p) => `<p>${p}</p>`).join("\n");
  const tag = s.list && s.list.type === "ol" ? "ol" : "ul";
  const list = s.list ? `\n<${tag}>\n${s.list.items.map((i) => `  <li>${i}</li>`).join("\n")}\n</${tag}>` : "";
  return `<section>\n<h2>${esc(s.heading)}</h2>\n${paras}${list}\n</section>`;
}

function renderGuide(page, bySlug) {
  const url = pageUrl(page.slug);
  const updated = page.updated || page.published;
  const minutes = Math.max(2, Math.round(wordCount(bodyText(page)) / 220));
  const related = (page.related || []).map((s) => bySlug.get(s)).filter(Boolean);

  const faqs = (page.faqs || []).length
    ? `<section class="faqs">\n<h2>Common questions</h2>\n${page.faqs
        .map((f) => `<details>\n<summary>${esc(f.q)}</summary>\n<p>${f.a}</p>\n</details>`)
        .join("\n")}\n</section>`
    : "";
  const relatedHtml = related.length
    ? `<aside class="related">\n<h2>Related guides</h2>\n<ul>\n${related
        .map((r) => `  <li><a href="/${r.slug}/">${esc(r.title)}</a><span>${esc(r.description)}</span></li>`)
        .join("\n")}\n</ul>\n</aside>`
    : "";
  const further = page.further
    ? `<p class="further">Further reading: <a href="${page.further.href}" rel="noopener">${esc(page.further.label)}</a></p>`
    : "";

  const body = `<article class="guide">
<p class="crumbs"><a href="/">Field Guide</a> / ${page.type === "question" ? "Questions" : "Concepts"}</p>
<h1>${esc(page.title)}</h1>
<p class="byline">By ${esc(site.name)} · <time datetime="${updated}">Updated ${formatDate(updated)}</time> · ${minutes} min read</p>
<div class="answer">
<p class="label">${page.type === "question" ? "Short answer" : "In one line"}</p>
<p>${page.answer}</p>
</div>
${page.sections.map(renderSection).join("\n")}
${faqs}
${further}
</article>
${relatedHtml}`;

  const schema = [
    websiteNode(),
    personNode(),
    {
      "@type": "Article",
      "@id": `${url}#article`,
      headline: page.title,
      description: page.description,
      author: { "@id": PERSON_ID },
      publisher: { "@id": PERSON_ID },
      datePublished: page.published,
      dateModified: updated,
      mainEntityOfPage: url,
      isPartOf: { "@id": WEBSITE_ID },
      inLanguage: "en-US",
    },
    breadcrumbs([
      ["Field Guide", `${site.url}/`],
      [page.title, url],
    ]),
  ];

  return layout({
    title: page.seoTitle || `${page.title} | ${site.name}`,
    description: page.description,
    canonical: url,
    schema,
    body,
    ogType: "article",
  });
}

function guideList(pages) {
  return `<ul class="guide-list">\n${pages
    .map((p) => `  <li><a href="/${p.slug}/">${esc(p.title)}</a><span>${esc(p.description)}</span></li>`)
    .join("\n")}\n</ul>`;
}

function renderHome(pages) {
  const byTitle = (a, b) => a.title.localeCompare(b.title);
  const recent = pages
    .slice()
    .sort((a, b) => (b.published + b.slug).localeCompare(a.published + a.slug))
    .slice(0, 4);
  const concepts = pages.filter((p) => p.type === "concept").sort(byTitle);
  const questions = pages.filter((p) => p.type === "question").sort(byTitle);

  const body = `<section class="intro">
<h1>${esc(site.name)}</h1>
<p class="lede">${esc(site.tagline)}</p>
<p>Each guide explains one idea in a few minutes: what it is, why it matters, and how to use it on a real team. The ideas come from agile delivery, systems thinking, and competitive gaming, where decisions are fast and feedback is honest.</p>
</section>
<section>
<h2>Recently added</h2>
${guideList(recent)}
</section>
<section id="guides">
<h2>Concepts</h2>
${guideList(concepts)}
</section>
<section>
<h2>Questions</h2>
${guideList(questions)}
</section>`;

  const schema = [
    websiteNode(),
    personNode(),
    {
      "@type": "CollectionPage",
      "@id": `${site.url}/#home`,
      url: `${site.url}/`,
      name: site.siteName,
      description: site.description,
      about: { "@id": PERSON_ID },
      isPartOf: { "@id": WEBSITE_ID },
      hasPart: pages.map((p) => ({ "@id": `${pageUrl(p.slug)}#article` })),
    },
  ];
  return layout({
    title: `${site.name} | Field Guide to Decisions, Systems & AI-Augmented Leadership`,
    description: site.description,
    canonical: `${site.url}/`,
    schema,
    body,
  });
}

function renderAbout() {
  const body = `<article class="guide">
<h1>About this field guide</h1>
<p class="lede">${esc(site.personDescription)}</p>
<section>
<h2>What this site is</h2>
<p>This is a reference shelf. Every page covers one concept or answers one question, in plain language, with enough depth to use it the same day. New guides are added twice a month.</p>
<p>The guides lean on three sources: agile delivery, where teams learn by shipping in short cycles; systems thinking, which looks at how structure drives behavior; and competitive gaming, which turns decision-making under pressure into something you can practice and review.</p>
</section>
<section>
<h2>How it differs from the essays</h2>
<p>The <a href="https://carenella1.github.io/">main site</a> holds longer essays that argue a point. This site is the glossary behind them: shorter, more definitional, and built to be skimmed.</p>
</section>
<section>
<h2>Elsewhere</h2>
<ul>
${site.elsewhere.map((e) => `  <li><a href="${e.href}" rel="noopener">${esc(e.label)}</a></li>`).join("\n")}
</ul>
</section>
</article>`;
  const url = `${site.url}/about/`;
  const schema = [
    websiteNode(),
    personNode(),
    { "@type": "AboutPage", "@id": `${url}#page`, url, name: "About this field guide", about: { "@id": PERSON_ID }, isPartOf: { "@id": WEBSITE_ID } },
    breadcrumbs([
      ["Field Guide", `${site.url}/`],
      ["About", url],
    ]),
  ];
  return layout({ title: `About | ${site.name}`, description: site.personDescription, canonical: url, schema, body });
}

function render404() {
  return layout({
    title: `Page not found | ${site.name}`,
    description: site.description,
    canonical: `${site.url}/404.html`,
    schema: [websiteNode()],
    body: `<section class="intro">\n<h1>Page not found</h1>\n<p>That page doesn't exist. Try the <a href="/#guides">full list of guides</a>.</p>\n</section>`,
  }).replace("<head>", '<head>\n<meta name="robots" content="noindex">');
}

function renderSitemap(pages) {
  const latest = pages.map((p) => p.updated || p.published).sort().pop();
  const urls = [
    [`${site.url}/`, latest],
    [`${site.url}/about/`, latest],
    ...pages.map((p) => [pageUrl(p.slug), p.updated || p.published]),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([loc, lastmod]) => `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod></url>`).join("\n")}
</urlset>
`;
}

function write(rel, content) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function main() {
  const pages = loadPages();
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  const known = new Set(bySlug.keys());

  const problems = [];
  for (const p of pages) {
    if (RESERVED.has(p.slug)) problems.push(`${p.slug}: slug is reserved`);
    for (const msg of checkPage(p, known)) problems.push(`${p.slug}: ${msg}`);
  }
  if (problems.length) {
    console.error(`Refusing to build:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }

  for (const p of pages) write(`${p.slug}/index.html`, renderGuide(p, bySlug));
  write("index.html", renderHome(pages));
  write("about/index.html", renderAbout());
  write("404.html", render404());
  write("sitemap.xml", renderSitemap(pages));
  write("robots.txt", `User-agent: *\nAllow: /\nDisallow: /content/\nDisallow: /scripts/\n\nSitemap: ${site.url}/sitemap.xml\n`);
  console.log(`Built ${pages.length} guides, home, about, 404, sitemap.`);
}

main();
