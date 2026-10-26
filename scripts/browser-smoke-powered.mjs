#!/usr/bin/env node
/**
 * Smoke after power-on + optional AR/GEOS probes; records failed request URLs.
 *   node scripts/browser-smoke-powered.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";
import { clearEmulatorJsCache, grok64DatapathFromEnv, installGrok64CoreNetworkGuard } from "./desktop-grok64-core.mjs";
import { patchLocalStorage, powerOnDesktop, waitRunning } from "./desktop-qa-lib.mjs";
import { existsSync, readFileSync } from "node:fs";

const url = checkedUrl(process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/");
const outDir = join(process.cwd(), "artifacts", "browser-smoke-powered");
mkdirSync(outDir, { recursive: true });

const failed = [];
const consoleErrors = [];

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("requestfailed", (req) => {
  const u = req.url();
  if (/\/system\/vice\/(JiffyDOS|dosCMD|cmdhd)/i.test(u)) return;
  failed.push({ url: u, failure: req.failure()?.errorText ?? "failed" });
});
page.on("response", (res) => {
  const status = res.status();
  if (status < 400) return;
  const u = res.url();
  if (/favicon\.ico|__app-env|og\.jpg|hot-update|\.map$/i.test(u)) return;
  if (status === 404 && /\/system\/vice\/(JiffyDOS|dosCMD|cmdhd)/i.test(u)) return;
  failed.push({ url: u, status });
});
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
await clearEmulatorJsCache(page);
if (grok64DatapathFromEnv()) await installGrok64CoreNetworkGuard(page, url);
await patchLocalStorage(page, { video: "pal", jiffy: false, mouse: true });
await page.reload({ waitUntil: "domcontentloaded" });
await powerOnDesktop(page, url, { navigate: false });
await waitRunning(page, 120_000);
await page.waitForFunction(() => /READY/i.test(window.__g64?.screenText?.() || ""), { timeout: 120_000 }).catch(() => null);

const arPath = join(process.cwd(), "fixtures/carts/ar6.crt");
if (existsSync(arPath)) {
  const bytes = [...readFileSync(arPath)];
  await page.evaluate(
    async ({ name, bytes }) => {
      await window.__g64?.playBytes?.(name, bytes, { autostart: true });
    },
    { name: "Action_Replay_V6.0_1989_PAL.crt", bytes },
  );
  await waitRunning(page, 90_000);
  await page.waitForTimeout(8000);
}

const geosPath = join(process.cwd(), "fixtures/geos/GEOS64_2.0.d64");
const geosAlt = existsSync(geosPath)
  ? geosPath
  : existsSync(join(process.cwd(), "fixtures/geos"))
    ? null
    : null;
let geosFile = geosPath;
if (!existsSync(geosFile)) {
  const { readdirSync } = await import("node:fs");
  const hits = readdirSync(join(process.cwd(), "fixtures/geos")).filter((n) => /\.d64$/i.test(n) && /geos/i.test(n));
  if (hits[0]) geosFile = join(process.cwd(), "fixtures/geos", hits[0]);
}
if (geosFile && existsSync(geosFile)) {
  const bytes = [...readFileSync(geosFile)];
  const name = geosFile.split("/").pop() || "GEOS64_2.0.d64";
  await page.evaluate(async ({ name, bytes }) => Boolean(await window.__g64?.bootGeos?.(name, bytes)), { name, bytes });
  await page.waitForTimeout(20_000);
}

const report = {
  url,
  grok64Datapath: grok64DatapathFromEnv(),
  failedRequests: failed,
  consoleErrors,
  screenTail: await page.evaluate(() => (window.__g64?.screenText?.() || "").slice(-160)),
  hasCanvas: (await page.locator("canvas").count()) > 0,
};
writeFileSync(join(outDir, "results.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
const optionalRom404 = (u) => /\/system\/vice\/(JiffyDOS|dosCMD|cmdhd)/i.test(u);
const bad = failed.filter((f) => !/favicon|og\.jpg|__app-env/i.test(f.url) && !optionalRom404(f.url));
process.exit(bad.length ? 1 : 0);
