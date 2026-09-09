import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const url = process.argv[2] || "http://127.0.0.1:8080/";
mkdirSync("/workspace/screenshots", { recursive: true });

const ONN_UA =
  "Mozilla/5.0 (Linux; Android 13; TBAF11 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Safari/537.36";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.71 Mobile/15E148 Safari/604.1";

const cases = [
  { name: "onn-land", ua: ONN_UA, viewport: { width: 1280, height: 800 }, expect: "tablet" },
  { name: "onn-port", ua: ONN_UA, viewport: { width: 800, height: 1280 }, expect: "tablet" },
  { name: "iphone", ua: IPHONE_UA, viewport: { width: 390, height: 844 }, expect: "phone" },
];

function containW(availW, availH) {
  if (!(availW >= 8) || !(availH >= 8)) return null;
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
    userAgent: c.ua,
    hasTouch: true,
    isMobile: c.expect === "phone",
    deviceScaleFactor: c.expect === "phone" ? 3 : 1.5,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 180)));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator(".g64-splash").waitFor({ timeout: 20000 });
  await page.waitForFunction(() => typeof window.__g64?.power === "function", { timeout: 15000 });
  await page.evaluate(() => window.__g64.power());
  await page.waitForSelector(".g64-bezel", { timeout: 15000 });
  await page.waitForTimeout(400);
  const geo = await page.evaluate(() => {
    const app = document.querySelector(".g64-app");
    const bezel = document.querySelector(".g64-bezel");
    const screen = document.querySelector(".g64-screen");
    const player = document.getElementById("grok64-player");
    const canvas = player?.querySelector("canvas:not(.g64-ios-present)");
    const box = (n) => {
      if (!n) return null;
      const r = n.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    };
    const cs = bezel ? getComputedStyle(bezel) : null;
    const padX = cs ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) : 0;
    const padY = cs ? (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) : 0;
    return {
      device: app?.getAttribute("data-device") ?? null,
      build: document.querySelector("[data-g64-build]")?.getAttribute("data-g64-build") ?? null,
      bezel: box(bezel),
      screen: box(screen),
      player: box(player),
      canvasCss: box(canvas),
      canvasBuf: canvas ? { w: canvas.width, h: canvas.height } : null,
      avail: bezel
        ? { w: Math.round(bezel.clientWidth - padX), h: Math.round(bezel.clientHeight - padY) }
        : null,
      crtW: bezel ? getComputedStyle(bezel).getPropertyValue("--g64-tablet-crt-w").trim() : "",
      screenXf: screen ? getComputedStyle(screen).transform : null,
      canvasXf: canvas ? getComputedStyle(canvas).transform : null,
    };
  });
  await page.screenshot({ path: `/workspace/screenshots/live-fit-${c.name}.png` });

  let ok = geo.device === c.expect && !errors.length;
  let why = "";
  if (c.expect === "tablet") {
    const targetW = containW(geo.avail?.w ?? 0, geo.avail?.h ?? 0);
    const targetH = targetW ? Math.round((targetW * 272) / 384) : null;
    const cover = targetW && geo.screen ? geo.screen.w / targetW : 0;
    const bezelFill =
      geo.screen && geo.bezel
        ? Math.min(geo.screen.w / geo.bezel.w, geo.screen.h / geo.bezel.h)
        : 0;
    const stamp = geo.screen && (geo.screen.w <= 400 || geo.screen.w <= (geo.bezel?.w ?? 0) * 0.45);
    ok = ok && !!targetW && cover >= 0.85 && bezelFill >= 0.85 && !stamp && !geo.crtW;
    if (geo.canvasCss && geo.screen) {
      ok = ok && geo.canvasCss.w >= geo.screen.w * 0.9;
    }
    why = JSON.stringify({
      targetW,
      targetH,
      cover: Number(cover.toFixed(3)),
      bezelFill: Number(bezelFill.toFixed(3)),
      stamp,
    });
  } else {
    const ar = geo.screen ? geo.screen.w / geo.screen.h : 0;
    ok = ok && ar > 1.3 && ar < 1.55;
    why = JSON.stringify({ ar: Number(ar.toFixed(3)) });
  }
  results.push({ name: c.name, ok, why, errors, geo });
  if (!ok) failed += 1;
  await context.close();
}

await browser.close();
writeFileSync("/workspace/screenshots/tablet-live-fit-qa.json", JSON.stringify({ failed, results }, null, 2));
console.log(JSON.stringify({ failed, results }, null, 2));
process.exit(failed ? 2 : 0);
