import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const url = process.argv[2] || "http://127.0.0.1:8080/";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1",
});
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 160)));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator(".g64-splash").waitFor({ timeout: 20000 });
await page.waitForTimeout(600);
await page.screenshot({ path: "/workspace/screenshots/power-before.png" });

const before = await page.evaluate(() => ({
  splash: !!document.querySelector(".g64-splash"),
  led: document.querySelector(".g64-power")?.getAttribute("data-on"),
  powered: window.__g64?.powered?.() ?? null,
}));
console.log("BEFORE", JSON.stringify(before));

await page.locator(".g64-splash").click({ force: true });
await page.waitForTimeout(300);

let afterTap = await page.evaluate(() => ({
  splash: !!document.querySelector(".g64-splash"),
  led: document.querySelector(".g64-power")?.getAttribute("data-on"),
  powered: window.__g64?.powered?.() ?? null,
  booting: window.__g64?.booting?.() ?? null,
  log: (window.__g64log || []).filter((l) => /power-on|power-fail|core-start|boot-begin|ejs-error|FIRE/.test(l)).slice(-8),
}));
console.log("AFTER TAP", JSON.stringify(afterTap));

if (!afterTap.powered) {
  console.log("tap missed — calling __g64.power()");
  await page.evaluate(() => window.__g64?.power?.());
  await page.waitForTimeout(300);
}

await page.screenshot({ path: "/workspace/screenshots/power-debug.png" });

let ready = null;
for (let i = 0; i < 90; i++) {
  ready = await page.evaluate(() => ({
    title: window.__g64?.title?.() ?? null,
    fs: window.__g64?.hasFs?.() ?? false,
    running: window.__g64?.running?.() ?? false,
    splash: !!document.querySelector(".g64-splash"),
    canvas: document.querySelectorAll("#grok64-player canvas").length,
  }));
  if (ready.running && ready.canvas && !ready.splash) {
    console.log("ready at", i, JSON.stringify(ready));
    break;
  }
  if (i % 6 === 0) console.log("wait", i, JSON.stringify(ready));
  await page.waitForTimeout(500);
}

await page.waitForTimeout(6000);
const pixels = await page.evaluate(() => {
  const c = document.querySelector("#grok64-player canvas");
  if (!c) return null;
  return {
    w: c.width,
    h: c.height,
    cssW: Math.round(c.clientWidth),
    cssH: Math.round(c.clientHeight),
  };
});
console.log("CANVAS", JSON.stringify(pixels));

const shot = await page.evaluate(async () => window.__g64?.shot?.());
if (shot) {
  writeFileSync("/workspace/screenshots/power-vice.png", Buffer.from(shot, "base64"));
  console.log("VICE shot bytes", Buffer.from(shot, "base64").length);
}

const canvas = page.locator("#grok64-player canvas").first();
if (await canvas.count()) {
  await canvas.screenshot({ path: "/workspace/screenshots/power-canvas.png" });
}
await page.screenshot({ path: "/workspace/screenshots/power-after.png" });
const probe = await page.evaluate(() => ({
  title: window.__g64?.title?.() ?? null,
  fs: window.__g64?.hasFs?.() ?? false,
  running: window.__g64?.running?.() ?? false,
  splash: !!document.querySelector(".g64-splash"),
  canvas: document.querySelectorAll("#grok64-player canvas").length,
  header: !!document.querySelector(".g64-top:not([hidden])"),
  log: (window.__g64log || []).slice(-10),
}));
console.log("PROBE", JSON.stringify(probe));
await browser.close();
const sized = pixels && pixels.w >= 64 && pixels.h >= 64 && pixels.cssW >= 64;
if (!probe.fs || probe.splash || !probe.canvas || !probe.running || !sized) process.exit(2);
process.exit(0);
