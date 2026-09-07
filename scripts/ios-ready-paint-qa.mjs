#!/usr/bin/env node
/**
 * Box smoke: CriOS UA, auto READY paint after power-on.
 * Does not claim a real-device PASS.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2] || "http://127.0.0.1:8080/";
mkdirSync("/workspace/screenshots", { recursive: true });

const browser = await chromium.launch({
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/135.0.7049.53 Mobile/15E148 Safari/604.1",
});
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForFunction(() => typeof window.__g64?.power === "function", { timeout: 20000 });
const osTag = await page.evaluate(() => document.documentElement.dataset.g64os ?? null);
if (osTag !== "ios") {
  console.log("FAIL expected data-g64os=ios, got", osTag);
  await browser.close();
  process.exit(2);
}

await page.evaluate(() => window.__g64.power());

let paint = null;
for (let i = 0; i < 80; i++) {
  paint = await page.evaluate(() => {
    const logs = window.__g64log || [];
    return {
      fs: window.__g64?.hasFs?.() ?? false,
      title: window.__g64?.title?.() ?? null,
      running: window.__g64?.running?.() ?? false,
      paintSettled: window.__g64?.paintSettled?.() ?? false,
      mirrorPainted: window.__g64?.mirrorPainted?.() ?? false,
      mirrorActive: window.__g64?.mirrorActive?.() ?? false,
      painted: logs.some((l) => /ios-mirror-painted|ios-frame-ok|ios-watchdog-painted/.test(String(l))),
      timeoutShot: logs.some((l) => /ios-screenshot-timeout/.test(String(l))),
      pollOnly:
        logs.filter((l) => /ios-paint-poll/.test(String(l))).length >= 4 &&
        !logs.some((l) => /ios-mirror-painted|ios-frame-ok/.test(String(l))),
      last: logs.slice(-8),
    };
  });
  if (paint.fs && paint.running && paint.title === "BASIC" && (paint.paintSettled || paint.mirrorPainted || paint.painted)) {
    await page.waitForTimeout(800);
    paint = await page.evaluate(() => {
      const logs = window.__g64log || [];
      return {
        fs: window.__g64?.hasFs?.() ?? false,
        title: window.__g64?.title?.() ?? null,
        running: window.__g64?.running?.() ?? false,
        paintSettled: window.__g64?.paintSettled?.() ?? false,
        mirrorPainted: window.__g64?.mirrorPainted?.() ?? false,
        mirrorActive: window.__g64?.mirrorActive?.() ?? false,
        painted: logs.some((l) => /ios-mirror-painted|ios-frame-ok|ios-watchdog-painted/.test(String(l))),
        timeoutShot: logs.some((l) => /ios-screenshot-timeout/.test(String(l))),
        pollOnly:
          logs.filter((l) => /ios-paint-poll/.test(String(l))).length >= 4 &&
          !logs.some((l) => /ios-mirror-painted|ios-frame-ok/.test(String(l))),
        last: logs.slice(-8),
      };
    });
    break;
  }
  await page.waitForTimeout(400);
}

const shot = await page.screenshot({ path: "/workspace/screenshots/ios-ready-paint-box.png", fullPage: false });
void shot;

console.log("READY-PAINT", JSON.stringify(paint, null, 2));
await browser.close();

if (pageErrors.length) {
  console.log("PAGEERRORS", pageErrors);
  process.exit(2);
}
if (!paint?.fs || paint.title !== "BASIC" || !paint.running) {
  console.log("FAIL never reached BASIC running");
  process.exit(2);
}
if (paint.pollOnly && !paint.paintSettled && !paint.mirrorPainted && !paint.painted) {
  console.log("FAIL stuck on ios-paint-poll with no READY paint");
  process.exit(2);
}
console.log("BOX ios READY paint path (not a real-device PASS)");
process.exit(0);
