// Tells IndexNow engines (Bing, and through it DuckDuckGo and Yahoo, plus
// Yandex, Seznam and Naver) that the site changed. Google doesn't take pings;
// it finds new pages through the sitemap in Search Console.
//
// Waits until the live sitemap matches the committed one, so engines don't
// crawl before GitHub Pages has deployed the change.
//
// Run: node scripts/ping-search-engines.js
const fs = require("fs");
const path = require("path");
const { ROOT, readJson } = require("./lib/content");

const site = readJson(path.join(ROOT, "content", "site.json"));
const HOST = new URL(site.url).host;
const INDEXNOW_KEY = "826efe037fd4f54f71e3ee4526e0911f";
const WAIT_MS = 10 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDeploy(localSitemap) {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${site.url}/sitemap.xml?t=${Date.now()}`, { cache: "no-store" });
      if (res.ok && (await res.text()) === localSitemap) return true;
    } catch (e) {
      console.log(`Sitemap check failed: ${e.message}`);
    }
    await sleep(20000);
  }
  return false;
}

async function main() {
  const sitemap = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
  const urls = [...sitemap.matchAll(/<url><loc>(.*?)<\/loc>/g)].map((m) => m[1]);
  console.log(`Found ${urls.length} page URLs in sitemap.xml`);

  if (!(await waitForDeploy(sitemap))) console.log("Live sitemap still differs after 10 minutes; pinging anyway.");

  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: HOST, key: INDEXNOW_KEY, keyLocation: `${site.url}/${INDEXNOW_KEY}.txt`, urlList: urls }),
  });
  console.log("IndexNow submission:", res.status, (await res.text()).slice(0, 200));
  // 200 = accepted, 202 = accepted pending key check. Anything else is worth a red run.
  if (![200, 202].includes(res.status)) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
