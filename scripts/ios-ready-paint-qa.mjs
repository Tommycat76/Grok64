#!/usr/bin/env node
/**
 * Box smoke: CriOS UA, live WebGL CRT after power-on.
 * Does not claim a real-device PASS.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2] || "http://127.0.0.1:8080/";
mkdirSync("/workspace/screenshots", { recursive: true });

function snapshot() {
  const logs = window.__g64log || [];
  const root = document.getElementById("grok64-player");
  const c = root?.querySelector("canvas");
  const cs = c ? getComputedStyle(c) : null;
  return {
    fs: window.__g64?.hasFs?.() ?? false,
    title: window.__g64?.title?.() ?? null,
    running: window.__g64?.running?.() ?? false,
    paintSettled: window.__g64?.paintSettled?.() ?? false,
    painted: logs.some((l) => /ios-crt-present|ios-frame-ok/.test(String(l))),
    paintPath: window.__g64?.paintPath?.() ?? null,
    overlay: Boolean(root?.querySelector(".g64-ios-mirror")),
    liveClass: root?.classList.contains("g64-ios-crt-live") ?? false,
    build: document.querySelector("[data-g64-build]")?.textContent ?? null,
    logUi: Boolean(document.querySelector(".g64-log")),
    poll: logs.some((l) => /ios-paint-poll/.test(String(l))),
    canvas: c
      ? {
          w: c.width,
          h: c.height,
          cw: c.clientWidth,
          ch: c.clientHeight,
          vis: cs?.visibility,
          op: cs?.opacity,
          disp: cs?.display,
        }
      : null,
    last: logs.slice(-8),
  };
}

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
  paint = await page.evaluate(snapshot);
  if (paint.fs && paint.running && paint.title === "BASIC" && (paint.paintSettled || paint.painted)) {
    await page.waitForTimeout(1500);
    paint = await page.evaluate(snapshot);
    break;
  }
  await page.waitForTimeout(400);
}

await page.screenshot({ path: "/workspace/screenshots/ios-ready-paint-box.png", fullPage: false });
await page.screenshot({ path: "/workspace/screenshots/ios-buildid-box.png", fullPage: false });

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
if (paint.poll) {
  console.log("FAIL ios-paint-poll still firing");
  process.exit(2);
}
if (paint.overlay) {
  console.log("FAIL leftover 2D overlay on CRT");
  process.exit(2);
}
if (paint.logUi) {
  console.log("FAIL production debug log still visible");
  process.exit(2);
}
if (!paint.build) {
  console.log("FAIL missing build id");
  process.exit(2);
}
if (paint.canvas && (paint.canvas.vis === "hidden" || paint.canvas.op === "0")) {
  console.log("FAIL live canvas is hidden");
  process.exit(2);
}
console.log("BOX ios live-WebGL CRT path (not a real-device PASS)");
process.exit(0);
