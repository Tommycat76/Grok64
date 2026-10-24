#!/usr/bin/env node
/**
 * Drive combo matrix harness (PARKED by default).
 *
 *   npm run test:desktop-drive-combo-matrix
 *   GROK64_DRIVE_COMBO_UNPARK=1 npm run test:desktop-drive-combo-matrix
 *
 * Evidence: screenshots/drive-matrix/ + artifacts/desktop-drive-combo-matrix/
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DRIVE_COMBO_SMOKE_ROWS,
  mapId,
  rowNeeds1571,
  rowNeedsCmdHd,
} from "./drive-combo-catalog.mjs";
import {
  patchLocalStorage,
  powerOnDesktop,
  typeBasic,
  waitRunning,
} from "./desktop-qa-lib.mjs";
import { assertGrok64WasmCore, clearEmulatorJsCache, grok64DatapathFromEnv } from "./desktop-grok64-core.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const unpark = process.env.GROK64_DRIVE_COMBO_UNPARK === "1";
const shotRoot = join(process.cwd(), "screenshots", "drive-matrix");
const artDir = join(process.cwd(), "artifacts", "desktop-drive-combo-matrix");
mkdirSync(shotRoot, { recursive: true });
mkdirSync(artDir, { recursive: true });

const ONLY = process.env.DRIVE_COMBO_ONLY?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
const rows = ONLY ? DRIVE_COMBO_SMOKE_ROWS.filter((r) => ONLY.includes(r.id)) : DRIVE_COMBO_SMOKE_ROWS;

if (!unpark) {
  const report = {
    parked: true,
    reason: "docs/DRIVE_COMBO_MATRIX.md — Tom must unpark (set GROK64_DRIVE_COMBO_UNPARK=1 to execute)",
    smokeRowCount: DRIVE_COMBO_SMOKE_ROWS.length,
    catalog: "scripts/drive-combo-catalog.mjs",
  };
  writeFileSync(join(artDir, "results.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  process.exit(0);
}

if (!grok64DatapathFromEnv()) {
  console.error("VITE_GROK64_VICE_DATAPATH missing");
  process.exit(1);
}

const testDisk = join(process.cwd(), "fixtures", "disks", "boulder-dash.d64");
const results = [];

function synthJiffyPair() {
  const c64 = new Uint8Array(8192);
  const d41 = new Uint8Array(8192);
  for (let i = 0; i < c64.length; i++) c64[i] = (i * 17 + 0x4a) & 0xff;
  for (let i = 0; i < d41.length; i++) d41[i] = (i * 13 + 0x41) & 0xff;
  return {
    "JiffyDOS_C64_6.01.bin": [...c64],
    "JiffyDOS_1541-II_6.00.bin": [...d41],
  };
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

for (const row of rows) {
  const rec = { id: row.id, map: row.mapLabel, op: row.op, pair: `${row.pairFrom}→${row.pairTo}`, pass: false };
  if (row.parkedSkip || rowNeeds1571(row)) {
    rec.skipped = true;
    rec.reason = row.notes ?? "1571 slot not modeled";
    results.push(rec);
    console.log("SKIP", row.id, rec.reason);
    continue;
  }
  if (rowNeedsCmdHd(row) && !process.env.GROK64_CMD_ROM_PATH) {
    rec.skipped = true;
    rec.reason = "CMD HD Boot ROM — set GROK64_CMD_ROM_PATH for smoke rows with cmdhd";
    results.push(rec);
    console.log("SKIP", row.id, rec.reason);
    continue;
  }

  await page.goto(base, { waitUntil: "domcontentloaded" });
  await clearEmulatorJsCache(page);
  await patchLocalStorage(page, {
    video: "ntsc",
    jiffy: false,
    reu: row.reu === "none" ? "none" : row.reu,
    iecMap: row.iecMap,
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
  await assertGrok64WasmCore(page, { timeoutMs: 120_000 });

  if (row.kernal === "jiffy") {
    const pair = synthJiffyPair();
    await page.evaluate(async (roms) => {
      for (const [name, bytes] of Object.entries(roms)) {
        const id = /1541/i.test(name) ? "jiffy-1541" : "jiffy-c64";
        await window.__g64?.putRomBytes?.(id, name, bytes);
      }
      window.__g64?.setJiffyDos?.(true);
    }, pair);
    await page.reload({ waitUntil: "domcontentloaded" });
    await powerOnDesktop(page, base, { navigate: false });
    await waitRunning(page, 120_000);
  }

  if (row.warp) await page.evaluate(() => window.__g64?.setWarp?.(true));

  const mapShot = join(shotRoot, `${row.id}-${mapId(row.iecMap)}-settings.png`);
  await page.screenshot({ path: mapShot, fullPage: true });

  if (existsSync(testDisk) && row.op === "DIR") {
    const bytes = [...readFileSync(testDisk)];
    await page.evaluate(
      async ({ bytes, unit }) => {
        await window.__g64?.playBytes?.("boulder-dash.d64", bytes, {
          autostart: false,
          title: "Boulder Dash",
          iecUnit: unit,
        });
      },
      { bytes, unit: row.pairFrom },
    );
    await waitRunning(page, 90_000);
    await typeBasic(page, `LOAD"$",${row.pairFrom}`, { afterMs: 15_000 });
    const text = await page.evaluate(() => window.__g64?.screenText?.() || "");
    rec.pass = !/FILE NOT FOUND|DEVICE NOT PRESENT/i.test(text) && text.length > 40;
    rec.textHead = text.slice(0, 120);
  } else if (row.op === "LOAD" || row.op === "COPY") {
    rec.skipped = true;
    rec.reason = "LOAD/COPY harness TBD — DIR smoke only in first unpark slice";
    rec.pass = false;
  }

  const crtShot = join(shotRoot, `${row.id}-${row.op.toLowerCase()}.png`);
  await page.screenshot({ path: crtShot, fullPage: true });
  rec.screenshots = [mapShot, crtShot];
  results.push(rec);
  console.log(rec.pass ? "PASS" : rec.skipped ? "SKIP" : "FAIL", row.id, rec.reason ?? rec.textHead ?? "");
}

await browser.close();
const failed = results.filter((r) => !r.pass && !r.skipped);
writeFileSync(
  join(artDir, "results.json"),
  JSON.stringify({ parked: false, generatedAt: new Date().toISOString(), results }, null, 2),
);
console.log(JSON.stringify({ pass: failed.length === 0, failed: failed.length, results }, null, 2));
process.exit(failed.length ? 1 : 0);
