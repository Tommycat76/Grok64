import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2] || "http://127.0.0.1:8080/";
mkdirSync("/workspace/screenshots", { recursive: true });

const browser = await chromium.launch({
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl"],
});
const context = await browser.newContext({
  viewport: { width: 1200, height: 2000 },
  userAgent:
    "Mozilla/5.0 (Linux; Android 13; TBAF11 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Safari/537.36",
  hasTouch: true,
  isMobile: false,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message.slice(0, 180)));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator(".g64-splash").waitFor({ timeout: 20000 });
await page.locator(".g64-power").waitFor({ timeout: 10000 });
await page.screenshot({ path: "/workspace/screenshots/tap-power-before.png" });

const btn = page.locator(".g64-power");
const box = await btn.boundingBox();
console.log("BUTTON", JSON.stringify({ box, tag: await btn.evaluate((el) => el.tagName) }));

await btn.tap({ timeout: 5000 });
await page.waitForTimeout(400);

const afterTap = await page.evaluate(() => ({
  powered: window.__g64?.powered?.(),
  booting: window.__g64?.booting?.(),
  splash: !!document.querySelector(".g64-splash"),
  last: (window.__g64log || []).slice(-8),
}));
console.log("AFTER_TAP", JSON.stringify({ ...afterTap, errors }));

const t0 = Date.now();
let st = afterTap;
while (Date.now() - t0 < 25000) {
  st = await page.evaluate(() => ({
    powered: window.__g64?.powered?.(),
    running: window.__g64?.running?.(),
    booting: window.__g64?.booting?.(),
    fs: window.__g64?.hasFs?.(),
    splash: !!document.querySelector(".g64-splash"),
    last: (window.__g64log || []).slice(-6),
  }));
  if (st.fs && st.running && !st.booting && !st.splash) break;
  await page.waitForTimeout(300);
}
await page.screenshot({ path: "/workspace/screenshots/tap-power-after.png" });
console.log("READY", JSON.stringify({ ...st, errors }));

await browser.close();
if (!afterTap.powered && afterTap.splash) {
  console.log("FAIL tap did not power on");
  process.exit(2);
}
if (!st.fs) {
  console.log("FAIL core did not start");
  process.exit(3);
}
console.log("PASS tapped the power button");
process.exit(0);
