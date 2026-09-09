import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(root, "scripts/tablet-bezel-fixture.html");
mkdirSync("/workspace/screenshots", { recursive: true });

const ONN_UA =
  "Mozilla/5.0 (Linux; Android 13; TBAF11 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Safari/537.36";

const cases = [
  { name: "onn-land", viewport: { width: 1280, height: 800 } },
  { name: "onn-port", viewport: { width: 800, height: 1280 } },
  { name: "onn-11", viewport: { width: 1200, height: 1920 } },
  { name: "onn-kb", viewport: { width: 1280, height: 800 } },
];

function containW(availW, availH) {
  return Math.round(Math.min(availW, (availH * 384) / 272));
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
  args: ["--no-sandbox"],
});
const results = [];
let failed = 0;

for (const c of cases) {
  const context = await browser.newContext({
    viewport: c.viewport,
    userAgent: ONN_UA,
    hasTouch: true,
    isMobile: false,
    deviceScaleFactor: 1.5,
  });
  const page = await context.newPage();
  await page.goto(`file://${fixture}`, { waitUntil: "domcontentloaded" });
  if (c.name === "onn-kb") {
    await page.evaluate(() => {
      const stage = document.querySelector(".g64-stage");
      if (stage) stage.style.maxHeight = "360px";
    });
  }
  const geo = await page.evaluate(() => {
    const bezel = document.querySelector(".g64-bezel");
    const screen = document.querySelector(".g64-screen");
    const br = bezel.getBoundingClientRect();
    const sr = screen.getBoundingClientRect();
    const cs = getComputedStyle(bezel);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    return {
      bezel: { w: Math.round(br.width), h: Math.round(br.height) },
      screen: { w: Math.round(sr.width), h: Math.round(sr.height) },
      avail: { w: Math.round(bezel.clientWidth - padX), h: Math.round(bezel.clientHeight - padY) },
    };
  });
  const targetW = containW(geo.avail.w, geo.avail.h);
  const targetH = Math.round((targetW * 272) / 384);
  const cover = targetW > 0 ? geo.screen.w / targetW : 0;
  const bezelFill = Math.min(geo.screen.w / geo.bezel.w, geo.screen.h / geo.bezel.h);
  const ok =
    geo.screen.w >= targetW * 0.85 &&
    geo.screen.h >= targetH * 0.85 &&
    bezelFill >= 0.85 &&
    geo.screen.w >= 400;
  await page.screenshot({ path: `/workspace/screenshots/tablet-bezel-${c.name}.png` });
  results.push({ name: c.name, ok, cover: Number(cover.toFixed(3)), targetW, targetH, ...geo });
  if (!ok) failed += 1;
  await context.close();
}

await browser.close();
writeFileSync("/workspace/screenshots/tablet-bezel-qa.json", JSON.stringify(results, null, 2));
console.log(JSON.stringify({ failed, results }, null, 2));
process.exit(failed ? 2 : 0);
