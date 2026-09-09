/**
 * iPhone-side guard for tablet CRT work: prove the #54 host wiring is
 * untouched — VICE still owns the backing (we never reassign a live one)
 * and the glass stays 384:272. WebKit-on-CriOS is NOT reproducible here;
 * this only catches a regression we caused, it is never a PASS.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const url = process.argv[2] || "http://127.0.0.1:8080/";
mkdirSync("/workspace/screenshots", { recursive: true });

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.71 Mobile/15E148 Safari/604.1";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent: IPHONE_UA,
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 160)}`);
});

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForFunction(() => typeof window.__g64?.power === "function", { timeout: 20000 });
await page.evaluate(() => window.__g64.power());

const backings = [];
const t0 = Date.now();
let snap = null;
while (Date.now() - t0 < 60000) {
  snap = await page.evaluate(() => {
    const player = document.getElementById("grok64-player");
    const canvas = player?.querySelector("canvas:not(.g64-ios-present)");
    const glass = document.querySelector(".g64-screen");
    const box = (n) => {
      if (!n) return null;
      const r = n.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    };
    return {
      device: document.querySelector(".g64-app")?.getAttribute("data-device") ?? null,
      running: window.__g64?.running?.() ?? null,
      booting: window.__g64?.booting?.() ?? null,
      paintPath: window.__g64?.paintPath?.() ?? null,
      backing: canvas ? { w: canvas.width, h: canvas.height } : null,
      canvasCls: canvas?.className ?? null,
      glass: box(glass),
      canvasRect: box(canvas),
      present: !!document.querySelector("canvas.g64-ios-present"),
      mirror: !!document.querySelector(".g64-ios-mirror"),
    };
  });
  if (snap.backing) backings.push({ t: Date.now() - t0, ...snap.backing });
  if (snap.backing && snap.running && !snap.booting) break;
  await page.waitForTimeout(1000);
}
await page.waitForTimeout(4000);
snap = { ...snap, ...(await page.evaluate(() => ({ running: window.__g64?.running?.() }))) };
await page.screenshot({ path: "/workspace/screenshots/probe-iphone-full.png" });
await browser.close();

// A live backing must never be reassigned (that is the #54 / #42 lock).
const uniq = [...new Set(backings.map((b) => `${b.w}x${b.h}`))];
const resized = uniq.length > 1;
const glassAspect = snap.glass ? snap.glass.w / snap.glass.h : 0;
const aspectOk = glassAspect > 1.36 && glassAspect < 1.46;
const ok = snap.device === "phone" && !resized && aspectOk && !snap.present && !snap.mirror;

const out = { ok, resized, uniqueBackings: uniq, glassAspect: Number(glassAspect.toFixed(3)), snap, errors: errors.slice(0, 6) };
writeFileSync("/workspace/screenshots/iphone-crt-probe.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
console.log("\nNOT a PASS — Tom's real CriOS is the only iPhone CRT PASS.");
process.exit(ok ? 0 : 2);
