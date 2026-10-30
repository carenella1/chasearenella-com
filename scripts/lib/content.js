// Shared rules for page content, used by build.js (as a last-line guard) and
// write-page.js (to reject a bad draft before it is saved).
//
// Privacy rules for this site — keep them when editing:
//   - Only the name "Chase Arenella" (and the handle ChaseOfSpadez) appears.
//     The full legal name never does: not in text, titles, or schema.
//   - No LinkedIn links, no photos, no personal details. The site is a
//     content brand, not a profile.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PAGES_DIR = path.join(ROOT, "content", "pages");

const BLOCKED = [
  { re: /\bscott\b/i, why: "the full legal name" },
  { re: /linkedin/i, why: "a LinkedIn reference" },
  { re: /expunge/i, why: "a legal-matter reference" },
];

// Inline HTML allowed inside paragraphs, list items, answers and callouts.
const ALLOWED_TAG = /^<\/?(strong|em|br)\s*\/?>$|^<a href="[^"<>]+">$|^<\/a>$/;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadPages() {
  return fs
    .readdirSync(PAGES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson(path.join(PAGES_DIR, f)));
}

// Every string in a page, for the privacy scan and word counts.
function allStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => allStrings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => allStrings(v, out));
  return out;
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, "");
}

function bodyText(page) {
  const parts = [page.answer];
  for (const s of page.sections) {
    parts.push(...s.paragraphs);
    if (s.list) parts.push(...s.list.items);
  }
  for (const f of page.faqs || []) parts.push(f.a);
  return stripTags(parts.join(" "));
}

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

// Returns a list of problems; empty means the page is fine to publish.
function checkPage(page, knownSlugs) {
  const problems = [];
  for (const field of ["slug", "type", "title", "description", "answer", "published"]) {
    if (!page[field]) problems.push(`missing "${field}"`);
  }
  if (page.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(page.slug)) problems.push(`slug "${page.slug}" is not kebab-case`);
  if (!["concept", "question"].includes(page.type)) problems.push(`type must be "concept" or "question"`);
  if (!Array.isArray(page.sections) || page.sections.length < 3) problems.push("needs at least 3 sections");
  if (page.description && page.description.length > 160) problems.push("description is over 160 characters");

  const strings = allStrings(page);
  for (const { re, why } of BLOCKED) {
    if (strings.some((s) => re.test(s))) problems.push(`contains ${why}`);
  }
  for (const s of strings) {
    for (const tag of s.match(/<[^>]*>/g) || []) {
      if (!ALLOWED_TAG.test(tag)) problems.push(`disallowed HTML ${tag}`);
    }
  }
  for (const rel of page.related || []) {
    if (knownSlugs && !knownSlugs.has(rel)) problems.push(`related slug "${rel}" does not exist`);
  }
  return problems;
}

module.exports = { ROOT, PAGES_DIR, readJson, loadPages, bodyText, wordCount, stripTags, checkPage };
