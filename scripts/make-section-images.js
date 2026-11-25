// Gives every guide section its own generated scene image, for any guide
// whose sections don't have one yet. Claude describes one scene per section
// (places and objects only, never people), OpenAI renders each, and the image
// is saved to assets/images/sections/chase-arenella-<slug>-<n>.jpg and
// recorded on the section in content/pages/<slug>.json. Run scripts/build.js
// afterwards to show them.
//
// Each image sits under the heading it illustrates, with alt text naming the
// section, the guide and the author, so it ranks in image search with real
// context around it.
//
// Usage:
//   node scripts/make-section-images.js --limit 2   # at most 2 guides this run
//   node scripts/make-section-images.js --dry-run
const fs = require("fs");
const path = require("path");
const { ROOT, PAGES_DIR, loadPages, stripTags, BLOCKED } = require("./lib/content");
const { callClaude, generateImage } = require("./lib/api");
const { STYLE, PEOPLE } = require("./lib/video");

const DIR = "assets/images/sections";
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const LIMIT = Number(args.includes("--limit") ? args[args.indexOf("--limit") + 1] : 2);

const SCHEMA = {
  type: "object",
  properties: {
    scenes: { type: "array", items: { type: "string" }, description: "One photograph description per section, in section order, each 15-30 words" },
  },
  required: ["scenes"],
  additionalProperties: false,
};

function prompt(page, correction) {
  const sections = page.sections
    .map((s, i) => `${i + 1}. ${s.heading}: ${stripTags([...s.paragraphs, ...(s.list ? s.list.items : [])].join(" "))}`)
    .join("\n");
  return `Describe one photograph for each section of this field guide entry, in order, to illustrate the section on a web page.

GUIDE: ${page.title}
SECTIONS:
${sections}

Rules:
- Exactly ${page.sections.length} descriptions, one per section, each 15-30 words.
- Each is a place, objects, or a setting that fits that section (a desk with an open notebook and a single pen, an empty meeting room with a wall clock, a whiteboard of blank sticky notes in columns, a game controller resting by a dim monitor).
- No people, faces, hands, players or silhouettes, and don't use those words in any sense.
- No readable text, screens with words, logos or brands.
- Vary the settings and viewpoints; no two scenes alike.${correction ? `\n\nYour previous attempt was rejected: ${correction}. Fix that.` : ""}`;
}

function check(scenes, count) {
  if (scenes.length !== count) return `it has ${scenes.length} descriptions; it needs exactly ${count}`;
  const all = scenes.join(" ");
  for (const { re, why } of BLOCKED) {
    const m = all.match(re);
    if (m) return `it contains ${why} ("${m[0]}"); leave that word out`;
  }
  const person = all.match(PEOPLE);
  if (person) return `a scene uses the word "${person[0]}"; scenes show only places and objects and must not use that word in any sense`;
  return null;
}

async function describe(page) {
  let correction = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { scenes } = await callClaude(prompt(page, correction), SCHEMA);
    correction = check(scenes, page.sections.length);
    if (!correction) return scenes;
    console.warn(`  scene attempt ${attempt} rejected: ${correction}`);
  }
  throw new Error(`no acceptable scenes after 3 attempts (${correction})`);
}

async function illustrate(page) {
  console.log(`\n[${page.slug}] describing ${page.sections.length} section scenes`);
  const scenes = await describe(page);
  fs.mkdirSync(path.join(ROOT, DIR), { recursive: true });
  const images = [];
  for (const [i, scene] of scenes.entries()) {
    const file = `${DIR}/chase-arenella-${page.slug}-${i + 1}.jpg`;
    fs.writeFileSync(path.join(ROOT, file), await generateImage(`${scene}\n\n${STYLE}`, "1536x1024"));
    images.push({
      file,
      alt: `${scene.replace(/\.$/, "")}. Illustration for "${page.sections[i].heading}", from "${page.title}", a field guide by Chase Arenella.`,
    });
    console.log(`[${page.slug}] section ${i + 1}: ${scene}`);
  }
  // Re-read the page file so only the image fields change.
  const file = path.join(PAGES_DIR, `${page.slug}.json`);
  const fresh = JSON.parse(fs.readFileSync(file, "utf8"));
  fresh.sections.forEach((s, i) => (s.image = images[i]));
  fs.writeFileSync(file, JSON.stringify(fresh, null, 2) + "\n");
}

async function main() {
  const pending = loadPages()
    .filter((p) => p.sections.some((s) => !s.image || !fs.existsSync(path.join(ROOT, s.image.file))))
    .sort((a, b) => a.published.localeCompare(b.published) || a.slug.localeCompare(b.slug));
  const batch = pending.slice(0, LIMIT);
  console.log(`${pending.length} guide(s) missing section images; this run: ${batch.map((p) => p.slug).join(", ") || "none"}`);
  if (DRY_RUN || batch.length === 0) return;

  let failures = 0;
  for (const page of batch) {
    try {
      await illustrate(page);
    } catch (e) {
      failures++;
      console.error(`[${page.slug}] failed: ${e.message}`);
      if (process.env.GITHUB_ACTIONS) console.log(`::error title=Section images failed: ${page.slug}::${e.message.replace(/\r?\n/g, " ")}`);
      for (let i = 1; i <= page.sections.length; i++) {
        fs.rmSync(path.join(ROOT, DIR, `chase-arenella-${page.slug}-${i}.jpg`), { force: true });
      }
    }
  }
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error("make-section-images.js failed:", e.message);
  process.exit(1);
});
