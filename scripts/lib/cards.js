// Title-card images: one 1200x630 PNG per guide, used as the page image,
// og:image, and image-sitemap entry. Cards are text and an abstract network
// pattern seeded by the slug, never photos (see the privacy rules in
// content.js). Fonts are bundled in scripts/fonts so a card renders the same
// locally and in CI, and an unchanged card renders to identical bytes.
const path = require("path");
const { Resvg } = require("@resvg/resvg-js");

const W = 1200;
const H = 630;
const FONT_DIR = path.join(__dirname, "..", "fonts");
const FONT = {
  fontFiles: [path.join(FONT_DIR, "SourceSerif4-Bold.ttf"), path.join(FONT_DIR, "Inter-SemiBold.ttf")],
  loadSystemFonts: false,
  defaultFontFamily: "Inter",
};
const SERIF = "Source Serif 4";
const SANS = "Inter";
const COLORS = { bg: "#13263a", bg2: "#0d1b2a", text: "#f7f5f0", muted: "#a9b8c6", accent: "#8cc1e8", warm: "#e8b86c" };
const TITLE_X = 80;
const TITLE_MAX_W = 780;

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Deterministic PRNG so the same slug always draws the same pattern.
function seeded(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const widthCache = new Map();
function textWidth(text, size) {
  const key = `${size}|${text}`;
  if (!widthCache.has(key)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="300"><text x="0" y="200" font-family="${SERIF}" font-size="${size}">${esc(text)}</text></svg>`;
    const box = new Resvg(svg, { font: FONT }).getBBox();
    widthCache.set(key, box ? box.width : 0);
  }
  return widthCache.get(key);
}

// Greedy word wrap at the largest size that fits in four lines.
function fitTitle(title) {
  const words = title.split(/\s+/);
  for (let size = 76; size >= 44; size -= 4) {
    const lines = [];
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (line && textWidth(next, size) > TITLE_MAX_W) {
        lines.push(line);
        line = w;
      } else line = next;
    }
    lines.push(line);
    if (lines.length <= 4 && lines.every((l) => textWidth(l, size) <= TITLE_MAX_W)) return { size, lines };
  }
  throw new Error(`Title too long for a card: "${title}"`);
}

function network(seed) {
  const rand = seeded(seed);
  const nodes = Array.from({ length: 16 }, () => ({ x: 700 + rand() * 440, y: 60 + rand() * 510, r: 4 + rand() * 7 }));
  const edges = new Set();
  nodes.forEach((a, i) => {
    nodes
      .map((b, j) => ({ j, d: Math.hypot(a.x - b.x, a.y - b.y) }))
      .filter((e) => e.j !== i)
      .sort((p, q) => p.d - q.d)
      .slice(0, 2)
      .forEach((e) => edges.add([Math.min(i, e.j), Math.max(i, e.j)].join("-")));
  });
  const hot = new Set([Math.floor(rand() * nodes.length), Math.floor(rand() * nodes.length)]);
  const lines = [...edges]
    .map((e) => e.split("-").map(Number))
    .map(([i, j]) => `<line x1="${nodes[i].x.toFixed(1)}" y1="${nodes[i].y.toFixed(1)}" x2="${nodes[j].x.toFixed(1)}" y2="${nodes[j].y.toFixed(1)}"/>`)
    .join("");
  const dots = nodes
    .map((n, i) => `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r.toFixed(1)}" fill="${hot.has(i) ? COLORS.warm : COLORS.accent}"/>`)
    .join("");
  return `<g opacity="0.35"><g stroke="${COLORS.accent}" stroke-width="2">${lines}</g>${dots}</g>`;
}

function cardSvg({ seed, label, title }) {
  const { size, lines } = fitTitle(title);
  const lineH = Math.round(size * 1.15);
  const blockH = lineH * (lines.length - 1);
  const firstY = Math.round(330 - blockH / 2 + size * 0.35);
  const titleText = lines
    .map((l, i) => `<tspan x="${TITLE_X}" y="${firstY + i * lineH}">${esc(l)}</tspan>`)
    .join("");
  const pillW = Math.round(label.length * 13 + 40);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${COLORS.bg}"/><stop offset="1" stop-color="${COLORS.bg2}"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
${network(seed)}
<text x="${TITLE_X}" y="96" font-family="${SANS}" font-size="22" letter-spacing="3" fill="${COLORS.accent}">CHASE ARENELLA · FIELD GUIDE</text>
<rect x="${TITLE_X}" y="124" width="${pillW}" height="36" rx="18" fill="none" stroke="${COLORS.warm}" stroke-width="2"/>
<text x="${TITLE_X + pillW / 2}" y="149" text-anchor="middle" font-family="${SANS}" font-size="16" letter-spacing="2" fill="${COLORS.warm}">${esc(label.toUpperCase())}</text>
<text font-family="${SERIF}" font-size="${size}" fill="${COLORS.text}">${titleText}</text>
<rect x="${TITLE_X}" y="528" width="64" height="4" fill="${COLORS.accent}"/>
<text x="${TITLE_X}" y="572" font-family="${SANS}" font-size="24" fill="${COLORS.muted}">chasearenella.com</text>
</svg>`;
}

function renderCard({ seed, label, title }) {
  return new Resvg(cardSvg({ seed, label, title }), { font: FONT, fitTo: { mode: "original" } }).render().asPng();
}

module.exports = { W, H, renderCard };
