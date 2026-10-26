#!/usr/bin/env node
/** Power → Play boulder-dash mount-only: bare READY, no LOAD"$" or LOAD"*". */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  grok64FloppyAutostartPoison,
  patchLocalStorage,
  powerOnDesktop,
  waitRunning,
  isBasicReadyScreen,
} from "./desktop-qa-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const out = "/opt/cursor/artifacts/screenshots";
mkdirSync(out, { recursive: true });
const disk = join(process.cwd(), "fixtures", "disks", "boulder-dash.d64");
const bytes = [...readFileSync(disk)];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(base);
await patchLocalStorage(page, { jiffy: false, video: "ntsc" });
await page.reload();
await powerOnDesktop(page, base, { navigate: false });
await waitRunning(page, 120_000);
await page.evaluate(
  async ({ bytes }) => {
    await window.__g64?.importLibraryBytes?.("boulder-dash.d64", bytes);
    await window.__g64?.playBytes?.("boulder-dash.d64", bytes, {
      autostart: false,
      title: "Boulder Dash",
    });
  },
  { bytes },
);
await waitRunning(page, 120_000);
await page.waitForTimeout(4000);
const text = await page.evaluate(() => window.__g64?.screenText?.() || "");
await page.screenshot({ path: join(out, "disk-mount-no-load.png"), fullPage: true });
const pass =
  isBasicReadyScreen(text) &&
  !/LOAD"\$"/i.test(text) &&
  !/LOAD"\*"/i.test(text) &&
  !/SEARCHING/i.test(text) &&
  !grok64FloppyAutostartPoison(text);
console.log(JSON.stringify({ pass, textHead: text.slice(0, 160) }, null, 2));
await browser.close();
process.exit(pass ? 0 : 1);
