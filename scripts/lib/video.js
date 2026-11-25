// One narrated video per guide, generated end to end with nothing recorded:
// Claude turns the guide into a ~70-second script, captions and four scene
// descriptions; OpenAI renders the scenes as images and narrates the script;
// ffmpeg renders a 1920x1080 video with on-screen captions.
//
// Videos are hosted on this site, each on its own watch page at
// /videos/<slug>/, so they rank in Google's Videos tab under the name.
//
// Privacy rules: the same as the pages (lib/content.js BLOCKED), plus scenes
// show only places and objects, never people.
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { callClaude, textToSpeech, generateImage } = require("./api");
const { ROOT, BLOCKED, stripTags } = require("./content");
const execFileP = promisify(execFile);

const W = 1920;
const H = 1080;
const FPS = 25;
const SCENES = 4;
const MAX_SECONDS = 100;
const TOP_BAND = 230;
const BOTTOM_BAND_Y = 800;
const FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const SCENE_DIR = "assets/images/generated";
const CLOSING = "More from Chase Arenella at chase arenella dot com.";

const STYLE =
  "Cinematic editorial photograph, calm light with deep navy blue and warm amber tones, shallow depth of field, " +
  "realistic, high detail. Absolutely no people, no human figures, no faces, no hands, no silhouettes. " +
  "No text, letters, numbers, logos or watermarks anywhere in the image.";

const PEOPLE = /\b(person|people|man|woman|men|women|face|faces|hands?|silhouettes?|crowd|team members?|employees?|colleagues?|players?)\b/i;

const SCRIPT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Video title, the guide's title or a close variant, at most 70 characters, without the author's name" },
    narration: { type: "string", description: "Voiceover script, 150 to 190 words" },
    captions: {
      type: "array",
      items: { type: "string" },
      description: "5 to 7 on-screen key points in narration order, each at most 42 characters",
    },
    description: { type: "string", description: "2 sentence description of the video, at most 250 characters" },
    scenes: {
      type: "array",
      items: { type: "string" },
      description: "4 photograph descriptions, one per quarter of the narration, each 15-30 words",
    },
  },
  required: ["title", "narration", "captions", "description", "scenes"],
  additionalProperties: false,
};

function guideText(page) {
  const parts = [`${page.type === "question" ? "SHORT ANSWER" : "IN ONE LINE"}: ${page.answer}`];
  for (const s of page.sections) {
    parts.push(`${s.heading.toUpperCase()}: ${s.paragraphs.join(" ")}`);
    if (s.list) parts.push(...s.list.items.map((x) => `- ${x}`));
  }
  return stripTags(parts.join("\n"));
}

function scriptPrompt(page, correction) {
  return `Write the script for a narrated video (about 70 seconds, landscape, text-to-speech voice) that explains this field guide entry by Chase Arenella.

GUIDE TITLE: ${page.title}
${guideText(page)}

Rules:
- Open with one sentence that states the idea or answers the question directly; no greetings, no "in this video".
- Then explain why it matters and how to use it, concretely, in short spoken sentences a voice reads well.
- Narration: 150 to 190 words. No lists read aloud, no URLs, no hashtags, no emoji.
- End with this exact sentence: "${CLOSING}"
- Use only ideas in the guide. Don't invent facts, numbers, or personal details about Chase Arenella. Call him only "Chase Arenella", never any other form of the name.
- Never mention legal matters, social profiles, or other websites.
- captions: 5 to 7 short on-screen key points that follow the narration's order, each at most 42 characters.
- description: 2 sentences, at most 250 characters, saying what the viewer will learn.
- scenes: exactly 4 photographs, one per quarter of the narration. Each is a 15-30 word description of a place, objects, or a setting (an empty meeting room at dawn, a desk with an open notebook and a cooling coffee, a quiet desk with a game controller beside a monitor's glow). No people, faces, hands, players or silhouettes, and don't use those words in any sense. No readable text, screens with words, logos or brands. Vary the settings.${correction ? `\n\nYour previous attempt was rejected: ${correction}. Fix that.` : ""}`;
}

// Returns null when the script is fine, or the reason it isn't, naming the
// exact word that tripped a check so the retry can fix it.
function checkScript(s) {
  const all = [s.title, s.narration, s.description, ...s.captions, ...s.scenes].join("\n");
  for (const { re, why } of BLOCKED) {
    const m = all.match(re);
    if (m) return `it contains ${why} ("${m[0]}"); leave that word out`;
  }
  const link = all.match(/https?:\/\/\S+|www\.\S+|\S+\.(com|org|net|io)\b|youtube|substack|chaseofspadez/i);
  if (link) return `it mentions another site or profile ("${link[0]}"); the only site reference allowed is the closing sentence, spelled out`;
  if (!s.narration.trim().endsWith(CLOSING)) return `the narration must end with the exact sentence "${CLOSING}"`;
  const words = s.narration.split(/\s+/).filter(Boolean).length;
  if (words < 140 || words > 200) return `the narration is ${words} words; it must be 150 to 190`;
  if (s.captions.length < 5 || s.captions.length > 7) return `it has ${s.captions.length} captions; it needs 5 to 7`;
  const long = s.captions.find((c) => c.length > 48);
  if (long) return `the caption "${long}" is over 42 characters`;
  if (s.scenes.length !== SCENES) return `it has ${s.scenes.length} scenes; it needs exactly ${SCENES}`;
  const person = s.scenes.join(" ").match(PEOPLE);
  if (person) return `a scene uses the word "${person[0]}"; scenes show only places and objects and must not use that word in any sense`;
  if (s.title.length > 80) return "the title is over 70 characters";
  return null;
}

async function writeScript(page) {
  let correction = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const s = await callClaude(scriptPrompt(page, correction), SCRIPT_SCHEMA);
    correction = checkScript(s);
    if (!correction) return s;
    console.warn(`  script attempt ${attempt} rejected: ${correction}`);
  }
  throw new Error(`no acceptable script after 3 attempts (${correction})`);
}

// Generates one landscape image per scene. Returns [{ file, alt }] with
// `file` relative to the repo root.
async function renderScenes(page, scenes) {
  fs.mkdirSync(path.join(ROOT, SCENE_DIR), { recursive: true });
  const out = [];
  for (const [i, scene] of scenes.entries()) {
    const file = `${SCENE_DIR}/chase-arenella-${page.slug}-${i + 1}.jpg`;
    fs.writeFileSync(path.join(ROOT, file), await generateImage(`${scene}\n\n${STYLE}`, "1536x1024"));
    out.push({ file, alt: `${scene.replace(/\.$/, "")}. From a Chase Arenella field guide video.` });
  }
  return out;
}

async function narrate(text, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, await textToSpeech(text));
  return outPath;
}

async function duration(file) {
  const { stdout } = await execFileP("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file]);
  return parseFloat(stdout.trim());
}

function wrap(text, maxChars) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && (line + " " + word).length > maxChars) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

// Text goes through textfile= (one file per line), so no text ever needs
// ffmpeg filter escaping.
function textLines({ workDir, name, text, maxChars, size, color, y, lineGap = 14, enable }) {
  return wrap(text, maxChars).map((line, i) => {
    const file = path.join(workDir, `${name}-${i}.txt`).replace(/\\/g, "/");
    fs.writeFileSync(file, line);
    const when = enable ? `:enable='${enable}'` : "";
    return `drawtext=fontfile='${FONT}':textfile='${file}':expansion=none:fontsize=${size}:fontcolor=${color}:x=(w-tw)/2:y=${y + i * (size + lineGap)}${when}`;
  });
}

async function renderVideo({ page, script, scenes, audioPath, outPath, workDir }) {
  if (!fs.existsSync(FONT)) throw new Error(`${FONT} not found; install fonts-dejavu-core`);
  const seconds = await duration(audioPath);
  if (seconds > MAX_SECONDS) throw new Error(`narration is ${seconds.toFixed(1)}s; too long`);
  const framesPer = Math.ceil((seconds * FPS) / scenes.length) + FPS;
  const zoomStep = (0.06 / framesPer).toFixed(8);

  // Each scene fills the frame with a slow push-in.
  const streams = scenes.map(
    (_, i) =>
      `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,` +
      `zoompan=z='min(zoom+${zoomStep},1.06)':d=${framesPer}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS},setsar=1[v${i}]`
  );
  const concat = `${scenes.map((_, i) => `[v${i}]`).join("")}concat=n=${scenes.length}:v=1:a=0[slides]`;

  fs.mkdirSync(workDir, { recursive: true });
  const slot = (seconds - 0.4) / script.captions.length;
  const overlays = [
    `drawbox=x=0:y=0:w=iw:h=${TOP_BAND}:color=black@0.5:t=fill`,
    `drawbox=x=0:y=${BOTTOM_BAND_Y}:w=iw:h=${H - BOTTOM_BAND_Y}:color=black@0.6:t=fill`,
    ...textLines({ workDir, name: "brand", text: "CHASE ARENELLA · FIELD GUIDE", maxChars: 60, size: 34, color: "0x8cc1e8", y: 40 }),
    ...textLines({ workDir, name: "title", text: page.title, maxChars: 48, size: 56, color: "white", y: 98 }),
    ...script.captions.flatMap((c, i) =>
      textLines({
        workDir,
        name: `cap${i}`,
        text: c,
        maxChars: 40,
        size: 58,
        color: "0xf7f5f0",
        y: 850,
        enable: `between(t,${(0.4 + i * slot).toFixed(2)},${(0.4 + (i + 1) * slot).toFixed(2)})`,
      })
    ),
    ...textLines({ workDir, name: "site", text: "chasearenella.com", maxChars: 40, size: 32, color: "0xa9b8c6", y: 1010 }),
  ];
  const graph = `${streams.join(";\n")};\n${concat};\n[slides]${overlays.join(",")}[vout]`;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await execFileP(
    "ffmpeg",
    [
      "-y",
      ...scenes.flatMap((s) => ["-i", path.join(ROOT, s.file)]),
      "-i", audioPath,
      "-filter_complex", graph,
      "-map", "[vout]",
      "-map", `${scenes.length}:a`,
      // crf 26 rather than 24: a guide a week adds up, and this keeps each
      // video around 5 MB so the repo stays well under GitHub Pages' 1 GB.
      "-c:v", "libx264", "-preset", "medium", "-crf", "26", "-pix_fmt", "yuv420p", "-r", String(FPS),
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      "-shortest",
      outPath,
    ],
    { maxBuffer: 1024 * 1024 * 50 }
  );
  return duration(outPath);
}

// A 1280x720 JPEG from early in the video (title and first caption showing),
// used as the poster and the thumbnail Google shows.
async function writeThumbnail(videoPath, outPath) {
  await execFileP("ffmpeg", ["-y", "-ss", "2", "-i", videoPath, "-frames:v", "1", "-vf", "scale=1280:720", "-q:v", "3", outPath]);
}

module.exports = { writeScript, checkScript, renderScenes, narrate, renderVideo, writeThumbnail, SCENES, STYLE, PEOPLE };
