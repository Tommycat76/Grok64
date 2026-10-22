#!/usr/bin/env node
/**
 * Sampled hardware matrix for desktop Chromium (see docs/TESTING.md).
 *   npm run test:desktop-matrix
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { matrixColdBoot, powerOnDesktop } from "./desktop-qa-lib.mjs";

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

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

// Seed persisted settings before matrix patches apply.
await powerOnDesktop(page, base);

const rows = [];
for (const combo of combos) {
  try {
    const r = await matrixColdBoot(page, base, combo);
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
