#!/usr/bin/env node
/**
 * Sampled hardware matrix for desktop Chromium (not full Cartesian — see docs/TESTING.md).
 *   npm run test:desktop-matrix
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const outDir = join(process.cwd(), "artifacts", "desktop-matrix");
mkdirSync(outDir, { recursive: true });

const combos = [
  { id: "pal-6581-1541", video: "pal", sid: "6581", sid2: "disabled", drive: "1541", jiffy: false, reu: "none" },
  { id: "ntsc-8580-1541", video: "ntsc", sid: "8580", sid2: "disabled", drive: "1541", jiffy: false, reu: "none" },
  { id: "pal-stereo-de00", video: "pal", sid: "6581", sid2: "0xde00", drive: "1541", jiffy: false, reu: "none" },
  { id: "pal-reu-2mb", video: "pal", sid: "6581", sid2: "disabled", drive: "1541", jiffy: false, reu: "2048kB" },
  { id: "sd2iec-slot", video: "pal", sid: "6581", sid2: "disabled", drive: "sd2iec", jiffy: false, reu: "none" },
  { id: "mouse-port2", video: "pal", sid: "6581", sid2: "disabled", drive: "1541", jiffy: false, reu: "none", mouse: true, joy: 2 },
];

async function coldBoot(page, combo) {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => typeof window.__g64?.power === "function")) break;
    await page.waitForTimeout(200);
  }
  await page.evaluate((combo) => {
    const keys = Object.keys(localStorage).filter((k) => k.includes("grok64"));
    if (!keys.length) return;
    const raw = localStorage.getItem(keys[0]);
    if (!raw) return;
    const data = JSON.parse(raw);
    data.state.videoStandard = combo.video;
    data.state.sidModel = combo.sid;
    data.state.sid2Address = combo.sid2;
    data.state.sid3Address = "disabled";
    data.state.reuSize = combo.reu;
    data.state.jiffyDos = combo.jiffy;
    data.state.mouseMode = !!combo.mouse;
    data.state.joyPort = combo.joy ?? 2;
    if (combo.drive === "sd2iec") {
      data.state.iecMap = { 8: "sd2iec", 9: "none", 10: "none", 11: "none" };
    } else {
      data.state.iecMap = { 8: combo.drive === "1581" ? "1581" : "1541", 9: "none", 10: "none", 11: "none" };
    }
    localStorage.setItem(keys[0], JSON.stringify(data));
  }, combo);
  await page.reload({ waitUntil: "domcontentloaded" });
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => typeof window.__g64?.power === "function")) break;
    await page.waitForTimeout(200);
  }
  await page.locator(".g64-power").waitFor({ timeout: 20000 });
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.evaluate(() => {
      document.querySelector(".g64-power")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    for (let i = 0; i < 30; i++) {
      if (await page.evaluate(() => window.__g64?.powered?.())) break;
      await page.waitForTimeout(250);
    }
    if (await page.evaluate(() => window.__g64?.powered?.())) break;
  }
  for (let i = 0; i < 80; i++) {
    if (await page.evaluate(() => window.__g64?.hasFs?.())) break;
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(5000);
  const text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  const fs = await page.evaluate(() => window.__g64?.hasFs?.());
  const ok = /READY/i.test(text) || (fs && (await page.evaluate(() => window.__g64?.running?.())));
  return { ok, head: text.slice(0, 60) || (fs ? "fs-ok" : "no-fs") };
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const rows = [];
for (const combo of combos) {
  try {
    const r = await coldBoot(page, combo);
    rows.push({ ...combo, pass: r.ok, detail: r.head });
  } catch (e) {
    rows.push({ ...combo, pass: false, error: String(e) });
  }
}
await browser.close();

const failed = rows.filter((r) => !r.pass);
writeFileSync(join(outDir, "matrix.json"), JSON.stringify({ rows, failed: failed.length }, null, 2));
console.log(JSON.stringify({ outDir, failed: failed.length, rows }, null, 2));
process.exit(failed.length ? 1 : 0);
