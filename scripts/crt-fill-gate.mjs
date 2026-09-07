#!/usr/bin/env node
/**
 * Deploy CRT-fill gate — run on PLEXnTORRENT_HP after pull/build/restart.
 *
 * Chromium (or G64_CHROME) at an iPhone viewport + touch + CriOS UA.
 * This is NOT real iPhone Safari/CriOS. A green run is a layout check,
 * not a Tom PASS. Cursor-sandbox WebKit is a dead end; this script exists
 * so the coordinator can gate the live host from Windows.
 *
 *   node scripts/crt-fill-gate.mjs
 *   node scripts/crt-fill-gate.mjs https://grok64.tomsprojects.cc/
 *   node scripts/crt-fill-gate.mjs http://127.0.0.1:8091/
 *
 * Optional later: BrowserStack real CriOS — not required this PR.
 *
 * Env:
 *   G64_GATE_URL     default live URL
 *   G64_CHROME       path to Chrome/Chromium if Playwright's browser is missing
 *   G64_GATE_SHOTS   screenshot directory (default <repo>/screenshots)
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.argv[2] || process.env.G64_GATE_URL || "https://grok64.tomsprojects.cc/";
const shotDir = process.env.G64_GATE_SHOTS || join(repoRoot, "screenshots");
mkdirSync(shotDir, { recursive: true });

const FILL_MIN = 0.85;
const SCALE_EPS = 0.02;
const IPHONE = { width: 390, height: 844 };
const CRIOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/135.0.7049.53 Mobile/15E148 Safari/604.1";

const failures = [];

function note(ok, msg, extra) {
  if (ok) {
    console.log("OK", msg, extra ? JSON.stringify(extra) : "");
    return;
  }
  failures.push(msg);
  console.log("FAIL", msg, extra ? JSON.stringify(extra) : "");
}

/** getComputedStyle().transform is a matrix, not the author string scale(...). */
function hasCssScale(xf) {
  const s = String(xf || "").trim().toLowerCase();
  if (!s || s === "none") return false;
  if (s.includes("scale(")) return true;
  const m3 = s.match(/matrix3d\(([^)]+)\)/);
  if (m3) {
    const n = m3[1].split(",").map((x) => Number(x.trim()));
    if (n.length < 11 || n.some((v) => Number.isNaN(v))) return false;
    return Math.abs(n[0] - 1) > SCALE_EPS || Math.abs(n[5] - 1) > SCALE_EPS;
  }
  const m2 = s.match(/matrix\(([^)]+)\)/);
  if (!m2) return false;
  const n = m2[1].split(",").map((x) => Number(x.trim()));
  if (n.length < 4 || n.some((v) => Number.isNaN(v))) return false;
  return Math.abs(n[0] - 1) > SCALE_EPS || Math.abs(n[3] - 1) > SCALE_EPS;
}

function launchOpts() {
  const opts = {
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
    ],
  };
  if (process.env.G64_CHROME) opts.executablePath = process.env.G64_CHROME;
  return opts;
}

function fillAgainst(inner, outer) {
  if (!inner || !outer || outer.w < 8 || outer.h < 8) {
    return { area: 0, fillW: 0, fillH: 0 };
  }
  const ix = Math.max(inner.x, outer.x);
  const iy = Math.max(inner.y, outer.y);
  const ir = Math.min(inner.x + inner.w, outer.x + outer.w);
  const ib = Math.min(inner.y + inner.h, outer.y + outer.h);
  const iw = Math.max(0, ir - ix);
  const ih = Math.max(0, ib - iy);
  return {
    area: (iw * ih) / (outer.w * outer.h),
    fillW: iw / outer.w,
    fillH: ih / outer.h,
  };
}

function assertFill(label, inner, outer, extra = {}) {
  const f = fillAgainst(inner, outer);
  const ok = f.area >= FILL_MIN && f.fillW >= FILL_MIN && f.fillH >= FILL_MIN;
  note(ok, `${label} fill ${f.area.toFixed(2)} (w ${f.fillW.toFixed(2)} h ${f.fillH.toFixed(2)})`, {
    inner,
    outer,
    ...extra,
  });
  if (inner && outer && (inner.w > outer.w * 1.15 || inner.h > outer.h * 1.15)) {
    note(false, `${label} overscaled past container (DPR scale hack)`, { inner, outer });
  }
  return f;
}

const measureSrc = () => {
  const box = (n) => {
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  };
  const bezel = document.querySelector(".g64-bezel");
  const screen = document.querySelector(".g64-screen");
  const boot = document.querySelector(".g64-boot");
  const player = document.getElementById("grok64-player");
  const canvas = player?.querySelector("canvas");
  const cs = canvas ? getComputedStyle(canvas) : null;
  const ps = player ? getComputedStyle(player) : null;
  const bezelBox = box(bezel);
  const screenBox = box(screen);
  let bezelInner = bezelBox;
  if (bezel && bezelBox) {
    const st = getComputedStyle(bezel);
    const pt = Number.parseFloat(st.paddingTop) || 0;
    const pr = Number.parseFloat(st.paddingRight) || 0;
    const pb = Number.parseFloat(st.paddingBottom) || 0;
    const pl = Number.parseFloat(st.paddingLeft) || 0;
    bezelInner = {
      x: bezelBox.x + pl,
      y: bezelBox.y + pt,
      w: Math.max(0, bezelBox.w - pl - pr),
      h: Math.max(0, bezelBox.h - pt - pb),
    };
  }
  return {
    os: document.documentElement.dataset.g64os ?? null,
    device: document.querySelector(".g64-app")?.getAttribute("data-device") ?? null,
    build: document.querySelector("[data-g64-build]")?.textContent?.trim() ?? null,
    log: Boolean(document.querySelector(".g64-log")),
    splash: Boolean(document.querySelector(".g64-splash")),
    booting: window.__g64?.booting?.() ?? Boolean(boot),
    running: window.__g64?.running?.() ?? false,
    powered: window.__g64?.powered?.() ?? false,
    fs: window.__g64?.hasFs?.() ?? false,
    title: window.__g64?.title?.() ?? null,
    overlay: Boolean(player?.querySelector(".g64-ios-mirror")),
    fb: canvas?.classList.contains("g64-ios-fb") ?? false,
    buf: canvas ? { w: canvas.width, h: canvas.height } : null,
    canvasCss: cs ? { w: cs.width, h: cs.height, xf: cs.transform } : null,
    playerXf: ps?.transform ?? null,
    bezel: bezelBox,
    bezelInner,
    screen: screenBox,
    boot: box(boot),
    player: box(player),
    canvas: box(canvas),
  };
};

const browser = await chromium.launch(launchOpts());
const context = await browser.newContext({
  viewport: IPHONE,
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  userAgent: CRIOS_UA,
});
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

console.log("GATE url", url);
console.log("GATE viewport", JSON.stringify({ ...IPHONE, dpr: 3, ua: "CriOS-iPhone" }));
console.log("GATE note Cursor-sandbox WebKit is not a ship gate. This script is the Plex layout check.");

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => typeof window.__g64?.power === "function", { timeout: 25000 });

const splash = await page.evaluate(measureSrc);
note(Boolean(splash.build), "build id visible on splash", { build: splash.build });
note(!splash.log, "debug log off by default");
await page.screenshot({ path: join(shotDir, "crt-fill-gate-splash.png"), fullPage: false });

await page.evaluate(() => window.__g64.power());

let bootGeom = null;
for (let i = 0; i < 40; i++) {
  const st = await page.evaluate(measureSrc);
  if (st.boot && st.screen && !st.splash) {
    bootGeom = st;
    break;
  }
  if (st.running && st.fs && !st.booting) break;
  await page.waitForTimeout(150);
}
if (bootGeom) {
  await page.screenshot({ path: join(shotDir, "crt-fill-gate-boot.png"), fullPage: false });
  assertFill("boot overlay vs screen", bootGeom.boot, bootGeom.screen, { msg: bootGeom.title });
  assertFill("screen vs bezel (boot)", bootGeom.screen, bootGeom.bezelInner);
} else {
  console.log("WARN boot overlay already gone — skip overlay fill (canvas check still runs)");
}

let ready = null;
for (let i = 0; i < 100; i++) {
  ready = await page.evaluate(measureSrc);
  if (ready.fs && ready.running && ready.canvas && ready.buf?.w >= 64 && !ready.splash) break;
  await page.waitForTimeout(400);
}
await page.screenshot({ path: join(shotDir, "crt-fill-gate-ready.png"), fullPage: false });

note(Boolean(ready?.build), "build id visible after power", { build: ready?.build });
note(!ready?.log, "debug log still off");
note(!ready?.overlay, "no PNG/2D overlay covering WebGL");
note(ready?.buf?.w === 384 && ready?.buf?.h === 272, "VICE backing 384x272", ready?.buf);
note(hasCssScale(ready?.playerXf), "player wrapper has scale()", {
  playerXf: ready?.playerXf,
});
note(!/matrix\([^)]*\)/.test(String(ready?.canvasCss?.xf || "")) || /matrix\(1,\s*0,\s*0,\s*1/.test(String(ready?.canvasCss?.xf || "")), "canvas transform is identity (scale is on wrapper)", {
  canvasXf: ready?.canvasCss?.xf,
});

if (ready?.screen && ready?.bezelInner) {
  assertFill("screen vs bezel (READY)", ready.screen, ready.bezelInner);
}
if (ready?.canvas && ready?.screen) {
  assertFill("canvas vs screen (READY)", ready.canvas, ready.screen);
}
if (ready?.player && ready?.screen) {
  assertFill("player vs screen (READY)", ready.player, ready.screen);
}

if (pageErrors.length) {
  note(false, `page errors: ${pageErrors.slice(0, 3).join(" | ")}`);
}

await browser.close();

console.log("");
console.log("GATE summary", JSON.stringify({ url, build: ready?.build ?? splash.build, failures: failures.length, fail: failures }));
console.log("GATE this is a Plex layout check, not a real CriOS PASS.");
if (failures.length) process.exit(2);
console.log("GATE layout OK — coordinator still needs Tom hard-refresh on the phone.");
process.exit(0);
