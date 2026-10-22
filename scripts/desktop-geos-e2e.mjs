#!/usr/bin/env node
/**
 * GEOS smoke — private media in GROK64_GEOS_DIR (.d64 / .g64 / .d81).
 *   GROK64_GEOS_DIR=/path npm run test:desktop-geos
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { canvasHasSignal, patchLocalStorage, powerOnDesktop, waitRunning } from "./desktop-qa-lib.mjs";

const dir = process.env.GROK64_GEOS_DIR;
const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const outDir = join(process.cwd(), "artifacts", "desktop-geos-e2e");
mkdirSync(outDir, { recursive: true });

if (!dir || !existsSync(dir)) {
  writeFileSync(join(outDir, "results.json"), JSON.stringify({ skipped: true, reason: "GROK64_GEOS_DIR missing" }));
  console.log("SKIP desktop-geos (set GROK64_GEOS_DIR)");
  process.exit(0);
}

const images = readdirSync(dir).filter((f) => /\.(d64|d81|g64|g71)$/i.test(f));
if (!images.length) {
  console.log("SKIP no disk images in GEOS dir");
  process.exit(0);
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(base, { waitUntil: "domcontentloaded" });
await patchLocalStorage(page, {
  video: "ntsc",
  sid: "8580",
  sid2: "disabled",
  reu: "16384kB",
  mouse: true,
  joy: 2,
  drive: "1541",
});
await page.reload();
await powerOnDesktop(page, base, { navigate: false });

const name = images[0];
const fileBuf = readFileSync(join(dir, name));
await page.evaluate(
  async ({ name, bytes }) => {
    await window.__g64?.playBytes?.(name, bytes);
  },
  { name, bytes: Array.from(fileBuf) },
);

await waitRunning(page, 90000);
await page.waitForTimeout(20000);
const ok = await canvasHasSignal(page);
writeFileSync(join(outDir, "results.json"), JSON.stringify({ name, pass: ok }, null, 2));
console.log(JSON.stringify({ name, pass: ok }));
await browser.close();
process.exit(ok ? 0 : 1);
