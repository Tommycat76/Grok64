#!/usr/bin/env node
/**
 * iPhone boot QA: READY at power-on + Boulder Dash play-recycle (never hot-swap).
 * Asserts non-black CRT canvas pixels (not just emulator state / PNG byte size).
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const url = process.argv[2] || "http://127.0.0.1:8080/";
mkdirSync("/workspace/screenshots", { recursive: true });

function analyzePng(path) {
  const out = execFileSync(
    "python3",
    [
      "-c",
      `
from PIL import Image
im=Image.open("${path}").convert("RGB")
px=list(im.getdata())
lum=sum(sum(p)/3 for p in px)/len(px)
uniq=len({(p[0]//16,p[1]//16,p[2]//16) for p in px})
print(f"{lum:.1f} {uniq}")
`,
    ],
    { encoding: "utf8" },
  ).trim();
  const [lum, uniq] = out.split(" ").map(Number);
  return { lum, uniq };
}

function frameAlive(metrics) {
  return Boolean(metrics && metrics.lum > 4 && metrics.uniq >= 2);
}

async function grabCanvasFrame(page, name) {
  const grabbed = await page.evaluate(() => window.__g64?.canvasShot?.() ?? null);
  if (!grabbed?.b64) return { ok: false, reason: "no-canvas-shot" };
  const path = `/workspace/screenshots/${name}.png`;
  writeFileSync(path, Buffer.from(grabbed.b64, "base64"));
  const px = analyzePng(path);
  return { ok: frameAlive(px), path, ...px, bytes: grabbed.bytes };
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
for (let i = 0; i < 60; i++) {
  const st = await page.evaluate(() => ({
    fs: window.__g64?.hasFs?.() ?? false,
    title: window.__g64?.title?.() ?? null,
    running: window.__g64?.running?.() ?? false,
    canvas: document.querySelectorAll("#grok64-player canvas").length,
  }));
  if (st.fs && st.canvas && st.running && st.title === "BASIC") break;
  await page.waitForTimeout(500);
}

let readyFrame = { ok: false, reason: "timeout" };
for (let i = 0; i < 40; i++) {
  readyFrame = await grabCanvasFrame(page, "ios-qa-ready-canvas");
  if (readyFrame.ok) break;
  await page.waitForTimeout(400);
}
const unlock = page.locator(".g64-unlock");
if (await unlock.count()) {
  console.log("WARN unexpected unlock overlay at READY");
}
const ready = {
  ...(await page.evaluate(() => ({
    title: window.__g64?.title?.(),
    fs: window.__g64?.hasFs?.(),
    running: window.__g64?.running?.(),
    canvas: document.querySelectorAll("#grok64-player canvas").length,
    g64os: document.documentElement.dataset.g64os,
    core: (() => {
      const log = (window.__g64log || []).find((l) => String(l).includes("boot-begin"));
      const m = log ? String(log).match(/"core":"([^"]+)"/) : null;
      return m?.[1] ?? null;
    })(),
  }))),
  frame: readyFrame,
};
console.log("READY", JSON.stringify(ready));

if (ready.core !== "c64") {
  console.log("FAIL iPhone should boot c64/vice_x64sc, got", ready.core);
  await browser.close();
  process.exit(2);
}
if (!ready.fs || !ready.running || ready.title !== "BASIC") {
  console.log("FAIL never reached BASIC READY");
  await browser.close();
  process.exit(2);
}
if (!ready.frame.ok) {
  console.log("FAIL CRT canvas blank at READY", ready.frame);
  await browser.close();
  process.exit(2);
}

await page.locator('button[aria-label="Software"]').first().click();
await page.locator(".g64-sheet").waitFor({ state: "visible", timeout: 8000 });
await page.locator(".g64-search input").fill("Boulder Dash");
await page.locator('.g64-search button[type="submit"]').click();
await page.waitForTimeout(2500);
const playHit = page.locator(".g64-hit").filter({ hasText: /boulder/i }).first();
if (!(await playHit.count())) {
  console.log("FAIL no Boulder Dash hit");
  await browser.close();
  process.exit(3);
}
const bootsBefore = await page.evaluate(
  () => (window.__g64log || []).filter((l) => /boot-begin|power-on/.test(String(l))).length,
);
await playHit.locator('button[aria-label^="Play"]').click();
for (let i = 0; i < 40; i++) {
  const t = await page.evaluate(() => window.__g64?.title?.() || "");
  if (/boulder/i.test(t)) break;
  await page.waitForTimeout(500);
}
await page.waitForTimeout(6000);
if (await unlock.count()) {
  console.log("WARN unexpected unlock overlay after hot-swap");
}
const bdFrame = await grabCanvasFrame(page, "ios-qa-bd-canvas");
const after = {
  ...(await page.evaluate(() => ({
    title: window.__g64?.title?.(),
    boots: (window.__g64log || []).filter((l) => /boot-begin|power-on/.test(String(l))).length,
    running: window.__g64?.running?.(),
    splash: !!document.querySelector(".g64-splash"),
    recycle: (window.__g64log || []).some((l) => /play-recycle/.test(String(l))),
    painted: (window.__g64log || []).some((l) => /ios-mirror-painted|ios-frame-ok|ios-live-webgl|ios-gl-blit/.test(String(l))),
  }))),
  frame: bdFrame,
};
console.log("BD", JSON.stringify(after));
await browser.close();

if (pageErrors.length) {
  console.log("PAGEERRORS", pageErrors);
  process.exit(2);
}
if (after.splash || !after.running) {
  console.log("FAIL splash or not running after load");
  process.exit(2);
}
if (!after.recycle && after.boots <= bootsBefore) {
  console.log("FAIL iPhone Play must recycle (never hot-swap)");
  process.exit(2);
}
if (!after.frame.ok) {
  console.log("FAIL CRT canvas blank after play-recycle", after.frame);
  process.exit(2);
}
console.log("BOX ios boot READY + boulder dash play-recycle (not a real-device PASS)");
process.exit(0);
