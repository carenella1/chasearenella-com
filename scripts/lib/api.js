// Raw HTTPS calls to the Claude and OpenAI APIs for the video pipeline
// and section images (scripts/make-videos.js, scripts/make-section-images.js).
const https = require("https");

function httpsPostJson(url, headers, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request(
      url,
      { method: "POST", headers: { ...headers, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// Structured output guarantees the JSON shape; refusals fall back server-side.
async function callClaude(prompt, schema) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const res = await httpsPostJson(
    "https://api.anthropic.com/v1/messages",
    {
      "x-api-key": apiKey,
      "anthropic-version": "2026-10-21",
      "anthropic-beta": "server-side-fallback-2026-07-01",
    },
    {
      model: "claude-opus-5-5",
      max_tokens: 16000,
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: prompt }],
    }
  );
  const body = res.body.toString();
  if (res.status !== 200) throw new Error(`Anthropic API returned ${res.status}: ${body.slice(0, 500)}`);
  const parsed = JSON.parse(body);
  if (parsed.stop_reason === "refusal") throw new Error("Claude declined the request");
  if (parsed.stop_reason === "max_tokens") throw new Error("Claude's reply was cut off (max_tokens)");
  const text = (parsed.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}

function openAiKey() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  return apiKey;
}

async function textToSpeech(text) {
  const res = await httpsPostJson(
    "https://api.openai.com/v1/audio/speech",
    { Authorization: `Bearer ${openAiKey()}` },
    { model: process.env.TTS_MODEL || "tts-1", voice: process.env.TTS_VOICE || "onyx", input: text, response_format: "mp3" }
  );
  if (res.status !== 200) throw new Error(`OpenAI TTS returned ${res.status}: ${res.body.toString().slice(0, 300)}`);
  return res.body;
}

// Returns JPEG bytes. Tries each model in turn, so a retired model id
// degrades to the next one instead of failing the video.
const IMAGE_MODELS = (process.env.IMAGE_MODEL || "gpt-image-2.5-flare,gpt-image-1.5").split(",");

async function generateImage(prompt, size) {
  let lastError;
  for (const model of IMAGE_MODELS) {
    const res = await httpsPostJson(
      "https://api.openai.com/v1/images/generations",
      { Authorization: `Bearer ${openAiKey()}` },
      { model, prompt, size, quality: "medium", n: 1, output_format: "jpeg", output_compression: 85 }
    );
    const body = res.body.toString();
    if (res.status === 200) return Buffer.from(JSON.parse(body).data[0].b64_json, "base64");
    lastError = new Error(`OpenAI images (${model}) returned ${res.status}: ${body.slice(0, 300)}`);
    if (![400, 404].includes(res.status)) break; // only a bad/unknown model is worth retrying on another
  }
  throw lastError;
}

module.exports = { httpsPostJson, callClaude, textToSpeech, generateImage };
