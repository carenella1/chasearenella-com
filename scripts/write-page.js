// Writes the next guide from content/queue.json with the Anthropic API and
// saves it to content/pages/<slug>.json. Run scripts/build.js afterwards to
// render it. A draft that fails any check (privacy rules, HTML, length,
// links, similarity to existing guides) is retried with the problem named,
// up to three times, and never saved.
//
// Run: ANTHROPIC_API_KEY=... node scripts/write-page.js
// Local test without the API: WRITE_PAGE_MOCK=1 node scripts/write-page.js
const fs = require("fs");
const path = require("path");
const { ROOT, PAGES_DIR, readJson, loadPages, bodyText, wordCount, checkPage } = require("./lib/content");

const QUEUE = path.join(ROOT, "content", "queue.json");
const MAIN_SITE_INDEX = "https://carenella1.github.io/content/articles-index.json";
const MODEL = "claude-sonnet-5-5";
const MIN_WORDS = 330;
const MAX_WORDS = 650;
const MAX_SIMILARITY = 0.3;

const VOICE = `Chase Arenella writes about AI-augmented leadership, systems thinking, and decision-making under pressure, drawing on agile delivery and competitive gaming. Voice: direct, structured, practical. Short declarative sentences, plain language, occasional <strong> for key terms, no filler, no hype, few em dashes. This site is a field guide: each page explains ONE concept or answers ONE question, in a reference style a reader can skim and use the same day.`;

function shingles(text, k = 5) {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const set = new Set();
  for (let i = 0; i + k <= words.length; i++) set.add(words.slice(i, i + k).join(" "));
  return set;
}

function jaccard(a, b) {
  let inter = 0;
  for (const s of a) if (b.has(s)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

async function mainSiteArticles() {
  try {
    const res = await fetch(MAIN_SITE_INDEX);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()).map((a) => ({ href: `https://carenella1.github.io/articles/${a.slug}.html`, title: a.title }));
  } catch (e) {
    console.warn(`Could not load main-site articles (${e.message}); the page will have no further-reading link.`);
    return [];
  }
}

function buildPrompt({ item, pages, articles, correction }) {
  const existing = pages.map((p) => `- ${p.slug}: "${p.title}" — ${p.description}`).join("\n");
  const further = articles.map((a) => `- ${a.href} — "${a.title}"`).join("\n") || "(none available; omit \"further\")";
  const answerLabel = item.type === "question" ? "a direct 1-2 sentence answer to the question" : "a 1-2 sentence definition";

  return `You are writing a new page for Chase Arenella's field guide site (chasearenella.com).

VOICE:
${VOICE}

PAGE TO WRITE:
Type: ${item.type} (${item.type === "question" ? "the title is the question, phrased the way people search it" : "the title is the concept's name"})
Angle: ${item.angle}

EXISTING GUIDES (do not repeat their angles or phrasing; pick 2-3 of these slugs for "related"):
${existing}

MAIN-SITE ESSAYS (optionally pick the ONE most relevant for "further", or omit "further" if none fits):
${further}

CONSTRAINTS:
- Body word count (answer + all section paragraphs and list items + FAQ answers): ${MIN_WORDS + 70}-${MAX_WORDS - 50} words.
- 4 sections, each with a heading and 1-2 paragraphs. At most 2 sections include a list (3-5 items).
- A section's list is always shown AFTER all of its paragraphs. So the last paragraph of a section with a list must lead into the list, and no paragraph may refer to text that comes after the list.
- 2 FAQs: short questions people actually search, each answered in 1-2 sentences.
- "answer": ${answerLabel}. It is shown in a highlighted box at the top.
- "description": under 155 characters, plain text.
- "seoTitle": "<title or a clear expansion of it> | Chase Arenella", under 80 characters.
- Inline HTML is limited to <strong> and <em>. No links inside the text, no other tags.
- Write in third person or second person, never as Chase in first person.
- Never mention any other name for Chase, legal matters, personal life, or social profiles. Stay on the brand topics.
${correction ? `\nIMPORTANT CORRECTION FROM A PREVIOUS ATTEMPT: ${correction}\n` : ""}
Respond with ONLY one valid JSON object (no code fences, no commentary) in exactly this shape:
{
  "title": "string",
  "seoTitle": "string",
  "description": "string",
  "answer": "string",
  "sections": [ { "heading": "string", "paragraphs": ["string"], "list": { "type": "ul or ol", "items": ["string"] } } ],
  "faqs": [ { "q": "string", "a": "string" } ],
  "related": ["existing-slug"],
  "further": { "href": "one of the essay URLs above", "label": "essay title followed by (essay)" }
}
The "list" key is optional per section; "further" is optional.`;
}

async function callAnthropic(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000, messages: [{ role: "user", content: prompt }] }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Anthropic API returned ${res.status}: ${body.slice(0, 500)}`);
  // The model may emit non-text blocks before its answer; join only the text ones.
  const text = (JSON.parse(body).content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  if (!text) throw new Error(`Anthropic response had no text content: ${body.slice(0, 500)}`);
  return text;
}

function mockDraft(item, pages) {
  const para = (n) => `This is mock paragraph ${n} about ${item.id}, written to exercise the pipeline without calling the API. `.repeat(4).trim();
  return JSON.stringify({
    title: `Mock: ${item.id}`,
    seoTitle: `Mock: ${item.id} | Chase Arenella`,
    description: `Mock description for ${item.id}.`,
    answer: `Mock answer for ${item.id}.`,
    sections: [1, 2, 3, 4].map((n) => ({ heading: `Mock section ${n}`, paragraphs: [para(n), para(n + 10)] })),
    faqs: [{ q: "Mock question?", a: "Mock answer." }],
    related: pages.slice(0, 2).map((p) => p.slug),
  });
}

// One topic per line, so a run's diff shows only the item it marked used.
function formatQueue(queue) {
  const line = (q) => `  { ${Object.entries(q).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ")} }`;
  return `[\n${queue.map(line).join(",\n")}\n]\n`;
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse((fenced ? fenced[1] : text).trim());
}

function review(page, pages, articles) {
  const known = new Set(pages.map((p) => p.slug));
  const problems = checkPage(page, known);
  if (/<a\s/i.test(JSON.stringify(page))) problems.push("contains a link inside the text; links are not allowed");
  if (page.further && !articles.some((a) => a.href === page.further.href)) problems.push(`"further" href is not one of the listed essay URLs`);

  const words = wordCount(bodyText(page));
  if (words < MIN_WORDS || words > MAX_WORDS) problems.push(`body is ${words} words; it must be ${MIN_WORDS}-${MAX_WORDS}`);

  const mine = shingles(bodyText(page));
  for (const p of pages) {
    const sim = jaccard(mine, shingles(bodyText(p)));
    if (sim > MAX_SIMILARITY) problems.push(`too similar to the existing guide "${p.slug}" (${sim.toFixed(2)})`);
  }
  return problems;
}

async function main() {
  const queue = readJson(QUEUE);
  const item = queue.find((q) => !q.used);
  if (!item) {
    console.error("No unused topics remain in content/queue.json; add more before the next run.");
    process.exit(1);
  }
  const pages = loadPages();
  if (pages.some((p) => p.slug === item.id)) {
    console.error(`A page with slug "${item.id}" already exists; mark that queue item used or rename it.`);
    process.exit(1);
  }
  const articles = await mainSiteArticles();
  const mock = process.env.WRITE_PAGE_MOCK === "1";

  let correction = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const raw = mock ? mockDraft(item, pages) : await callAnthropic(buildPrompt({ item, pages, articles, correction }));
    let draft;
    try {
      draft = extractJson(raw);
    } catch (e) {
      correction = "Your previous response was not valid JSON. Respond with only the JSON object.";
      console.error(`Attempt ${attempt}: output was not valid JSON (${e.message}).`);
      continue;
    }
    const page = { slug: item.id, type: item.type, ...draft, published: new Date().toISOString().slice(0, 10) };
    if (!page.further) delete page.further;
    const problems = review(page, pages, articles);
    if (problems.length && !mock) {
      correction = `Fix these problems: ${problems.join("; ")}.`;
      console.error(`Attempt ${attempt} rejected: ${problems.join("; ")}`);
      continue;
    }
    fs.writeFileSync(path.join(PAGES_DIR, `${page.slug}.json`), JSON.stringify(page, null, 2) + "\n");
    item.used = new Date().toISOString();
    fs.writeFileSync(QUEUE, formatQueue(queue));
    console.log(`Wrote content/pages/${page.slug}.json ("${page.title}", ${wordCount(bodyText(page))} words).`);
    return;
  }
  console.error("Three drafts in a row failed review; nothing was saved.");
  process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
