#!/usr/bin/env node
/**
 * Best-available iOS simulation: Playwright WebKit + iPhone UA/viewport.
 * Not real CriOS. Never treat a green run as PASS.
 */
import { webkit } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2] || "http://127.0.0.1:8080/";
mkdirSync("/workspace/screenshots", { recursive: true });

const CRIOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/135.0.7049.53 Mobile/15E148 Safari/604.1";

const browser = await webkit.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  userAgent: CRIOS_UA,
});
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForFunction(() => typeof window.__g64?.power === "function", { timeout: 20000 });

const splash = await page.evaluate(() => ({
  os: document.documentElement.dataset.g64os ?? null,
  build: document.querySelector("[data-g64-build]")?.textContent ?? null,
  log: Boolean(document.querySelector(".g64-log")),
}));

await page.evaluate(() => window.__g64.power());

let state = null;
for (let i = 0; i < 80; i++) {
  state = await page.evaluate(() => {
    const root = document.getElementById("grok64-player");
    const c = root?.querySelector("canvas");
    const cs = c ? getComputedStyle(c) : null;
    const logs = window.__g64log || [];
    const screen = document.querySelector(".g64-screen");
    const br = (n) => {
      if (!n) return null;
      const r = n.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    return {
      fs: window.__g64?.hasFs?.() ?? false,
      title: window.__g64?.title?.() ?? null,
      running: window.__g64?.running?.() ?? false,
      path: window.__g64?.paintPath?.() ?? null,
      overlay: Boolean(root?.querySelector(".g64-ios-mirror")),
      live: root?.classList.contains("g64-ios-crt-live") ?? false,
      present: logs.some((l) => /ios-crt-present/.test(String(l))),
      poll: logs.some((l) => /ios-paint-poll/.test(String(l))),
      build: document.querySelector("[data-g64-build]")?.textContent ?? null,
      log: Boolean(document.querySelector(".g64-log")),
      vis: cs?.visibility ?? null,
      op: cs?.opacity ?? null,
      w: c?.width ?? 0,
      h: c?.height ?? 0,
      cssW: cs?.width ?? null,
      cssH: cs?.height ?? null,
      xf: cs?.transform ?? null,
      fb: c?.classList.contains("g64-ios-fb") ?? false,
      screen: br(screen),
      canvasCss: br(c),
      playerXf: root ? getComputedStyle(root).transform : null,
      bezel: br(document.querySelector(".g64-bezel")),
    };
  });
  if (state.fs && state.running && state.title === "BASIC") break;
  await page.waitForTimeout(400);
}

await page.screenshot({ path: "/workspace/screenshots/ios-crt-webkit.png", fullPage: false });
console.log("WEBKIT-SPLASH", JSON.stringify(splash));
console.log("WEBKIT-CRT", JSON.stringify(state, null, 2));
await browser.close();

if (pageErrors.length) {
  console.log("PAGEERRORS", pageErrors);
  process.exit(2);
}
if (splash.os !== "ios") {
  console.log("FAIL WebKit UA did not tag iOS");
  process.exit(2);
}
if (!splash.build || !state?.build) {
  console.log("FAIL build id missing on WebKit");
  process.exit(2);
}
if (splash.log || state.log) {
  console.log("FAIL debug log visible on WebKit without ?debug=1");
  process.exit(2);
}
if (state.overlay) {
  console.log("FAIL 2D overlay present");
  process.exit(2);
}
if (state.poll) {
  console.log("FAIL paint-poll still in logs");
  process.exit(2);
}
if (state.vis === "hidden" || state.op === "0") {
  console.log("FAIL live canvas hidden");
  process.exit(2);
}
if (state.w !== 384 || state.h !== 272) {
  console.log("INFO canvas.width getter", state.w, state.h, "(VICE lock; drawing buffer may match CSS)");
}
if (!state.fb) {
  console.log("FAIL missing g64-ios-fb");
  process.exit(2);
}
if (/scale\(/i.test(String(state.playerXf || "")) || (/matrix\(/i.test(String(state.playerXf || "")) && !/matrix\(1,\s*0,\s*0,\s*1/.test(String(state.playerXf || "")))) {
  console.log("FAIL player wrapper still uses CSS scale (CriOS stamp path)", state.playerXf);
  process.exit(2);
}
if (state.canvasCss && state.screen && state.screen.w > 0) {
  const fillW = state.canvasCss.w / state.screen.w;
  const fillH = state.canvasCss.h / state.screen.h;
  if (fillW < 0.85 || fillH < 0.85) {
    console.log(
      "FAIL postage stamp",
      JSON.stringify({ canvas: state.canvasCss, screen: state.screen, fillW, fillH }),
    );
    process.exit(2);
  }
}
console.log("WEBKIT iPhone-UA CRT smoke (not a real CriOS PASS)");
process.exit(0);
