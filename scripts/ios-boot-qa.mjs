#!/usr/bin/env node
/**
 * iPhone boot QA: READY at power-on + Boulder Dash hot-swap without restart.
 * Verifies vice_x64sc (accurate) core path and stable boot on mobile UA.
 */
import { chromium } from "playwright";

const url = process.argv[2] || "http://127.0.0.1:8080/";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
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
let bootCore = null;
for (let i = 0; i < 60; i++) {
  const st = await page.evaluate(() => {
    const log = (window.__g64log || []).find((l) => String(l).includes("boot-begin"));
    const m = log ? String(log).match(/"core":"([^"]+)"/) : null;
    return {
      core: m?.[1] ?? null,
      fs: window.__g64?.hasFs?.() ?? false,
      title: window.__g64?.title?.() ?? null,
      running: window.__g64?.running?.() ?? false,
      canvas: document.querySelectorAll("#grok64-player canvas").length,
    };
  });
  bootCore = st.core;
  if (st.fs && st.canvas && st.running && st.title === "BASIC") break;
  await page.waitForTimeout(500);
}

const ready = await page.evaluate(async () => {
  let frame = false;
  try {
    const shot = await window.__g64?.shot?.();
    frame = Boolean(shot && shot.bytes > 2500);
  } catch {}
  return {
    title: window.__g64?.title?.(),
    fs: window.__g64?.hasFs?.(),
    running: window.__g64?.running?.(),
    canvas: document.querySelectorAll("#grok64-player canvas").length,
    g64os: document.documentElement.dataset.g64os,
    frame,
    core: (() => {
      const log = (window.__g64log || []).find((l) => String(l).includes("boot-begin"));
      const m = log ? String(log).match(/"core":"([^"]+)"/) : null;
      return m?.[1] ?? null;
    })(),
  };
});
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
if (!ready.frame) {
  console.log("FAIL VICE framebuffer empty (blank CRT)");
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
const after = await page.evaluate(async () => {
  let frame = false;
  try {
    const shot = await window.__g64?.shot?.();
    frame = Boolean(shot && shot.bytes > 2500);
  } catch {}
  return {
    title: window.__g64?.title?.(),
    boots: (window.__g64log || []).filter((l) => /boot-begin|power-on/.test(String(l))).length,
    running: window.__g64?.running?.(),
    splash: !!document.querySelector(".g64-splash"),
    frame,
  };
});
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
if (after.boots > bootsBefore) {
  console.log("FAIL full core recycle during hot-swap");
  process.exit(2);
}
if (!after.frame) {
  console.log("FAIL VICE framebuffer empty after hot-swap (blank CRT)");
  process.exit(2);
}
console.log("PASS ios boot READY + boulder dash hot-swap");
process.exit(0);
