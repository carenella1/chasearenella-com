// Renders the whole site from content/: the home page, one page per guide at
// /<slug>/, a title-card image per guide, the about page, 404, sitemap.xml and
// robots.txt. Output is committed and served as-is by GitHub Pages.
//
// Run: node scripts/build.js
const fs = require("fs");
const path = require("path");
const { ROOT, readJson, loadPages, bodyText, wordCount, checkPage } = require("./lib/content");
const cards = require("./lib/cards");

const site = readJson(path.join(ROOT, "content", "site.json"));
const PERSON_ID = `${site.url}/#person`;
const WEBSITE_ID = `${site.url}/#website`;
const RESERVED = new Set(["about", "assets", "content", "scripts", "videos"]);
const VIDEOS_FILE = path.join(ROOT, "content", "videos.json");
// Videos made by scripts/make-videos.js. Set in main(); the nav shows a
// Videos link only once there is at least one.
let videos = [];

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function pageUrl(slug) {
  return `${site.url}/${slug}/`;
}

// Image files are named for the brand so they rank in image search too.
function guideImage(page) {
  return {
    file: `assets/images/chase-arenella-${page.slug}.png`,
    alt: `${page.title}: a Chase Arenella field guide ${page.type === "question" ? "answer" : "entry"}`,
    label: page.type === "question" ? "Question" : "Concept",
    title: page.title,
    seed: page.slug,
  };
}

const HOME_IMAGE = {
  file: "assets/images/chase-arenella-field-guide.png",
  alt: "Chase Arenella field guide to decisions, systems, and AI-augmented leadership",
  label: "Reference",
  title: "Decisions, Systems & AI-Augmented Leadership",
  seed: "home",
};

function sectionImages(page) {
  return page.sections.filter((s) => s.image).map((s) => ({ file: s.image.file }));
}

function imageUrl(img) {
  return `${site.url}/${img.file}`;
}

function imageNode(img) {
  return {
    "@type": "ImageObject",
    "@id": `${imageUrl(img)}#image`,
    url: imageUrl(img),
    contentUrl: imageUrl(img),
    width: cards.W,
    height: cards.H,
    caption: img.alt,
    creator: { "@id": PERSON_ID },
  };
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

function layout({ title, description, canonical, schema, body, ogType = "website", image }) {
  const imageMeta = image
    ? `<meta property="og:image" content="${imageUrl(image)}">
<meta property="og:image:width" content="${cards.W}">
<meta property="og:image:height" content="${cards.H}">
<meta property="og:image:alt" content="${esc(image.alt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${imageUrl(image)}">`
    : `<meta name="twitter:card" content="summary">`;
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
${imageMeta}
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
      <a href="/#guides">Guides</a>${videos.length ? `\n      <a href="/videos/">Videos</a>` : ""}
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
  // Section images come from scripts/make-section-images.js.
  const img = s.image
    ? `\n<figure class="section-img"><img src="/${s.image.file}" alt="${esc(s.image.alt)}" width="1536" height="1024" loading="lazy"></figure>`
    : "";
  return `<section>\n<h2>${esc(s.heading)}</h2>${img}\n${paras}${list}\n</section>`;
}

function renderGuide(page, bySlug) {
  const url = pageUrl(page.slug);
  const image = guideImage(page);
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
  const vid = videos.find((v) => v.slug === page.slug);
  const watch = vid
    ? `<p class="watch"><a href="/videos/${page.slug}/">▶ Watch the ${Math.round(vid.durationSeconds / 10) * 10}-second video version</a></p>\n`
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
${watch}<figure class="card"><img src="/${image.file}" alt="${esc(image.alt)}" width="${cards.W}" height="${cards.H}" loading="lazy"></figure>
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
      image: sectionImages(page).length
        ? [{ "@id": `${imageUrl(image)}#image` }, ...sectionImages(page).map(imageUrl)]
        : { "@id": `${imageUrl(image)}#image` },
      mainEntityOfPage: url,
      isPartOf: { "@id": WEBSITE_ID },
      inLanguage: "en-US",
    },
    imageNode(image),
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
    image,
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
      primaryImageOfPage: { "@id": `${imageUrl(HOME_IMAGE)}#image` },
      hasPart: pages.map((p) => ({ "@id": `${pageUrl(p.slug)}#article` })),
    },
    imageNode(HOME_IMAGE),
  ];
  return layout({
    title: `${site.name} | Field Guide to Decisions, Systems & AI-Augmented Leadership`,
    description: site.description,
    canonical: `${site.url}/`,
    schema,
    body,
    image: HOME_IMAGE,
  });
}

function renderAbout() {
  const body = `<article class="guide">
<h1>About this field guide</h1>
<p class="lede">${esc(site.personDescription)}</p>
<section>
<h2>What this site is</h2>
<p>This is a reference shelf. Every page covers one concept or answers one question, in plain language, with enough depth to use it the same day. New guides are added every week.</p>
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
  return layout({ title: `About | ${site.name}`, description: site.personDescription, canonical: url, schema, body, image: HOME_IMAGE });
}

function watchUrl(v) {
  return `${site.url}/videos/${v.slug}/`;
}

function isoDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `PT${m ? `${m}M` : ""}${s}S`;
}

function videoNode(v) {
  return {
    "@type": "VideoObject",
    "@id": `${watchUrl(v)}#video`,
    name: `${v.title} | ${site.name}`,
    description: v.description,
    thumbnailUrl: [`${site.url}/${v.thumbnail}`],
    uploadDate: v.uploadDate,
    duration: isoDuration(v.durationSeconds),
    contentUrl: `${site.url}/${v.file}`,
    transcript: v.transcript,
    inLanguage: "en-US",
    author: { "@id": PERSON_ID },
    creator: { "@id": PERSON_ID },
    publisher: { "@id": PERSON_ID },
    isPartOf: { "@id": WEBSITE_ID },
  };
}

// The video is the page's main content, which Google requires before it
// will index a video on a page.
function renderWatch(v, page) {
  const url = watchUrl(v);
  const sentences = v.transcript.match(/[^.!?]+[.!?]+/g) || [v.transcript];
  const paras = [];
  for (let i = 0; i < sentences.length; i += 4) paras.push(sentences.slice(i, i + 4).join(" ").trim());
  const date = v.uploadDate.slice(0, 10);

  const body = `<article class="guide watch-page">
<p class="crumbs"><a href="/videos/">Videos</a></p>
<h1>${esc(v.title)}</h1>
<p class="byline">A video by ${esc(site.name)} · <time datetime="${date}">${formatDate(date)}</time> · ${Math.round(v.durationSeconds)} seconds</p>
<video class="player" controls preload="metadata" playsinline poster="/${v.thumbnail}" width="1920" height="1080">
  <source src="/${v.file}" type="video/mp4">
</video>
<p class="lede">${esc(v.description)}</p>
<p class="further">The full written guide: <a href="/${page.slug}/">${esc(page.title)}</a></p>
<section>
<h2>Transcript</h2>
${paras.map((p) => `<p>${esc(p)}</p>`).join("\n")}
</section>
<section>
<h2>Scenes from this video</h2>
<div class="scenes">
${v.scenes.map((s) => `<img src="/${s.file}" alt="${esc(s.alt)}" width="1536" height="1024" loading="lazy">`).join("\n")}
</div>
</section>
</article>`;

  const schema = [
    websiteNode(),
    personNode(),
    videoNode(v),
    breadcrumbs([
      ["Videos", `${site.url}/videos/`],
      [v.title, url],
    ]),
  ];
  return layout({
    title: `${v.title} (Video) | ${site.name}`,
    description: v.description,
    canonical: url,
    schema,
    body,
    ogType: "video.other",
    image: null,
  }).replace(
    '<meta name="twitter:card" content="summary">',
    `<meta property="og:image" content="${site.url}/${v.thumbnail}">
<meta property="og:video" content="${site.url}/${v.file}">
<meta property="og:video:type" content="video/mp4">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${site.url}/${v.thumbnail}">`
  );
}

function renderVideoHub() {
  const list = videos.slice().sort((a, b) => b.uploadDate.localeCompare(a.uploadDate));
  const body = `<section class="intro">
<h1>Videos by ${esc(site.name)}</h1>
<p class="lede">Short narrated explainers, one for each field guide entry: the idea, why it matters, and how to use it.</p>
</section>
<ul class="video-list">
${list
  .map(
    (v) => `  <li><a href="/videos/${v.slug}/"><img src="/${v.thumbnail}" alt="${esc(v.title)}: a video by ${esc(site.name)}" width="1280" height="720" loading="lazy"><span class="t">${esc(v.title)}</span></a><span>${esc(v.description)}</span></li>`
  )
  .join("\n")}
</ul>`;
  const url = `${site.url}/videos/`;
  const schema = [
    websiteNode(),
    personNode(),
    {
      "@type": "CollectionPage",
      "@id": `${url}#page`,
      url,
      name: `Videos by ${site.name}`,
      about: { "@id": PERSON_ID },
      isPartOf: { "@id": WEBSITE_ID },
      hasPart: list.map((v) => ({ "@id": `${watchUrl(v)}#video` })),
    },
    breadcrumbs([
      ["Field Guide", `${site.url}/`],
      ["Videos", url],
    ]),
  ];
  return layout({
    title: `Videos | ${site.name}`,
    description: `Narrated video explainers of the field guide by ${site.name}.`,
    canonical: url,
    schema,
    body,
    image: HOME_IMAGE,
  });
}

function renderVideoSitemap() {
  const xml = (s) => esc(s).replace(/'/g, "&apos;");
  const entry = (v) => `  <url>
    <loc>${watchUrl(v)}</loc>
    <video:video>
      <video:thumbnail_loc>${site.url}/${v.thumbnail}</video:thumbnail_loc>
      <video:title>${xml(`${v.title} | ${site.name}`)}</video:title>
      <video:description>${xml(v.description)}</video:description>
      <video:content_loc>${site.url}/${v.file}</video:content_loc>
      <video:duration>${Math.round(v.durationSeconds)}</video:duration>
      <video:publication_date>${v.uploadDate}</video:publication_date>
      <video:family_friendly>yes</video:family_friendly>
      <video:uploader info="${site.url}/about/">${xml(site.name)}</video:uploader>
    </video:video>
${v.scenes.map((s) => `    <image:image><image:loc>${site.url}/${s.file}</image:loc></image:image>`).join("\n")}
  </url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${videos.map(entry).join("\n")}
</urlset>
`;
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
    [`${site.url}/`, latest, HOME_IMAGE],
    [`${site.url}/about/`, latest],
    ...pages.map((p) => [pageUrl(p.slug), p.updated || p.published, [guideImage(p), ...sectionImages(p)]]),
  ];
  if (videos.length) {
    const thumb = (v) => ({ file: v.thumbnail });
    const newest = videos.map((v) => v.uploadDate.slice(0, 10)).sort().pop();
    urls.push([`${site.url}/videos/`, newest, thumb(videos[0])]);
    for (const v of videos) urls.push([watchUrl(v), v.uploadDate.slice(0, 10), thumb(v)]);
  }
  const entry = ([loc, lastmod, imgs]) =>
    `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod>${[imgs || []]
      .flat()
      .map((img) => `<image:image><image:loc>${imageUrl(img)}</image:loc></image:image>`)
      .join("")}</url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map(entry).join("\n")}
</urlset>
`;
}

function write(rel, content) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// Rewrites a card only when its pixels change, so rebuilds don't churn git.
function writeCard(img) {
  const png = cards.renderCard(img);
  const file = path.join(ROOT, img.file);
  if (fs.existsSync(file) && fs.readFileSync(file).equals(png)) return;
  write(img.file, png);
}

function main() {
  const pages = loadPages();
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  const known = new Set(bySlug.keys());
  videos = (fs.existsSync(VIDEOS_FILE) ? readJson(VIDEOS_FILE) : []).filter((v) => {
    if (bySlug.has(v.slug) && fs.existsSync(path.join(ROOT, v.file))) return true;
    console.warn(`Skipping video "${v.slug}": no matching guide or missing ${v.file}`);
    return false;
  });

  const problems = [];
  for (const p of pages) {
    if (RESERVED.has(p.slug)) problems.push(`${p.slug}: slug is reserved`);
    for (const msg of checkPage(p, known)) problems.push(`${p.slug}: ${msg}`);
  }
  if (problems.length) {
    console.error(`Refusing to build:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }

  for (const p of pages) {
    writeCard(guideImage(p));
    write(`${p.slug}/index.html`, renderGuide(p, bySlug));
  }
  writeCard(HOME_IMAGE);
  write("index.html", renderHome(pages));
  write("about/index.html", renderAbout());
  write("404.html", render404());
  for (const v of videos) write(`videos/${v.slug}/index.html`, renderWatch(v, bySlug.get(v.slug)));
  if (videos.length) {
    write("videos/index.html", renderVideoHub());
    write("video-sitemap.xml", renderVideoSitemap());
  }
  write("sitemap.xml", renderSitemap(pages));
  // Read by carenella1.github.io to link each essay to the guides built on it.
  write("guides.json", `${JSON.stringify(
    pages
      .slice()
      .sort((a, b) => a.slug.localeCompare(b.slug))
      .map((p) => ({ url: pageUrl(p.slug), title: p.title, image: imageUrl(guideImage(p)), essay: p.further ? p.further.href : null })),
    null,
    2
  )}\n`);
  const sitemaps = [`${site.url}/sitemap.xml`, ...(videos.length ? [`${site.url}/video-sitemap.xml`] : [])];
  write("robots.txt", `User-agent: *\nAllow: /\nDisallow: /content/\nDisallow: /scripts/\n\n${sitemaps.map((s) => `Sitemap: ${s}`).join("\n")}\n`);
  console.log(`Built ${pages.length} guides and their cards, ${videos.length} video page(s), home, about, 404, sitemaps.`);
}

main();
