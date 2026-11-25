// Makes a video for each guide that doesn't have one yet (lib/video.js)
// and records it in content/videos.json the moment it's done, so a later
// failure never loses a finished video. Run scripts/build.js afterwards to
// add the watch pages and the video sitemap.
//
// Usage:
//   node scripts/make-videos.js --limit 2      # make at most 2 this run
//   node scripts/make-videos.js --dry-run      # list what would be made
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ROOT, loadPages, readJson } = require("./lib/content");
const video = require("./lib/video");

const VIDEOS_FILE = path.join(ROOT, "content", "videos.json");
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const LIMIT = Number(args.includes("--limit") ? args[args.indexOf("--limit") + 1] : 2);
const WORK = path.join(process.env.RUNNER_TEMP || os.tmpdir(), "videos");

function readVideos() {
  return fs.existsSync(VIDEOS_FILE) ? readJson(VIDEOS_FILE) : [];
}

function writeVideos(list) {
  list.sort((a, b) => a.slug.localeCompare(b.slug));
  fs.writeFileSync(VIDEOS_FILE, JSON.stringify(list, null, 2) + "\n");
}

async function make(page) {
  const workDir = path.join(WORK, page.slug);
  console.log(`\n[${page.slug}] writing script`);
  const script = await video.writeScript(page);
  console.log(`[${page.slug}] "${script.title}"\n  ${script.narration}`);
  const audioPath = await video.narrate(script.narration, path.join(workDir, "narration.mp3"));
  console.log(`[${page.slug}] generating ${video.SCENES} scenes`);
  const scenes = await video.renderScenes(page, script.scenes);

  const base = `videos/${page.slug}/chase-arenella-${page.slug}`;
  console.log(`[${page.slug}] rendering`);
  const seconds = await video.renderVideo({ page, script, scenes, audioPath, outPath: path.join(ROOT, `${base}.mp4`), workDir });
  await video.writeThumbnail(path.join(ROOT, `${base}.mp4`), path.join(ROOT, `${base}.jpg`));
  const mb = fs.statSync(path.join(ROOT, `${base}.mp4`)).size / 1e6;
  console.log(`[${page.slug}] ${seconds.toFixed(1)}s, ${mb.toFixed(1)} MB`);

  return {
    slug: page.slug,
    title: script.title,
    description: script.description,
    transcript: script.narration,
    captions: script.captions,
    file: `${base}.mp4`,
    thumbnail: `${base}.jpg`,
    scenes,
    durationSeconds: Math.round(seconds),
    uploadDate: new Date().toISOString(),
  };
}

async function main() {
  const done = new Set(readVideos().map((v) => v.slug));
  const pending = loadPages()
    .filter((p) => !done.has(p.slug))
    .sort((a, b) => a.published.localeCompare(b.published) || a.slug.localeCompare(b.slug));
  const batch = pending.slice(0, LIMIT);
  console.log(`${pending.length} guide(s) without a video; this run: ${batch.map((p) => p.slug).join(", ") || "none"}`);
  if (DRY_RUN || batch.length === 0) return;

  let failures = 0;
  for (const page of batch) {
    try {
      const entry = await make(page);
      writeVideos([...readVideos(), entry]);
    } catch (e) {
      failures++;
      console.error(`[${page.slug}] failed: ${e.message}`);
      // Don't leave half-made files to be committed; the next run redoes them.
      fs.rmSync(path.join(ROOT, "videos", page.slug), { recursive: true, force: true });
      for (let i = 1; i <= video.SCENES; i++) {
        fs.rmSync(path.join(ROOT, "assets/images/generated", `chase-arenella-${page.slug}-${i}.jpg`), { force: true });
      }
      if (process.env.GITHUB_ACTIONS) console.log(`::error title=Video failed: ${page.slug}::${e.message.replace(/\r?\n/g, " ")}`);
    }
  }
  if (failures) {
    console.error(`\n${failures} of ${batch.length} video(s) failed.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("make-videos.js failed:", e.message);
  process.exit(1);
});
