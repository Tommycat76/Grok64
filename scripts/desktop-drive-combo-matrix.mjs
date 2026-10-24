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
  iecMapForHarness,
  mapId,
  rowNeeds1571,
  rowTouchesCmdHd,
} from "./drive-combo-catalog.mjs";
import { patchLocalStorage, powerOnDesktop, waitRunning } from "./desktop-qa-lib.mjs";
import {
  assertGrok64WasmCore,
  clearEmulatorJsCache,
  grok64DatapathFromEnv,
  installGrok64CoreNetworkGuard,
} from "./desktop-grok64-core.mjs";
import {
  applySyntheticJiffy,
  captureViceDriveBus,
  dirOnUnit,
  ensureLibraryFixture,
  insertFloppyViaLibraryUI,
  loadSmokeOnUnit,
  powerCycleDesktop,
} from "./drive-combo-qa-lib.mjs";

const expectedCoreBuildId = JSON.parse(
  readFileSync(join(process.cwd(), "public/system/vice/emulatorjs/data/cores/grok64-core-manifest.json"), "utf8"),
).buildId;

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

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await installGrok64CoreNetworkGuard(page, base);

for (const row of rows) {
  const rec = { id: row.id, map: row.mapLabel, op: row.op, pair: `${row.pairFrom}→${row.pairTo}`, pass: false };
  if (row.parkedSkip || rowNeeds1571(row)) {
    rec.skipped = true;
    rec.reason = row.notes ?? "1571 slot not modeled";
    results.push(rec);
    console.log("SKIP", row.id, rec.reason);
    continue;
  }
  const cmdRomPath = process.env.GROK64_CMD_ROM_PATH;
  if (rowTouchesCmdHd(row) && !cmdRomPath) {
    rec.skipped = true;
    rec.reason = "CMD HD Boot ROM — set GROK64_CMD_ROM_PATH when pair uses cmdhd unit";
    results.push(rec);
    console.log("SKIP", row.id, rec.reason);
    continue;
  }

  const iecMap = iecMapForHarness(row, { cmdRomAvailable: Boolean(cmdRomPath) });
  if (cmdRomPath) rec.cmdRom = cmdRomPath;

  await page.goto(base, { waitUntil: "domcontentloaded" });
  await clearEmulatorJsCache(page);
  await patchLocalStorage(page, {
    video: "pal",
    jiffy: false,
    reu: row.reu === "none" ? "none" : row.reu,
    iecMap,
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
  await assertGrok64WasmCore(page, { timeoutMs: 120_000 });
  await powerCycleDesktop(page);
  await assertGrok64WasmCore(page, { timeoutMs: 120_000 });

  if (cmdRomPath) {
    const romBytes = [...readFileSync(cmdRomPath)];
    await page.evaluate(async (bytes) => {
      await window.__g64?.putRomBytes?.("cmdhd", "dosCMDHD.bin", bytes);
    }, romBytes);
  }

  if (row.kernal === "jiffy") {
    await applySyntheticJiffy(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await powerOnDesktop(page, base, { navigate: false });
    await waitRunning(page, 120_000);
  }

  if (row.warp) await page.evaluate(() => window.__g64?.setWarp?.(true));

  const mapShot = join(shotRoot, `${row.id}-${mapId(row.iecMap)}-settings.png`);
  await page.screenshot({ path: mapShot, fullPage: true });

  if (!existsSync(testDisk)) {
    rec.skipped = true;
    rec.reason = "fixtures/disks/boulder-dash.d64 missing";
    rec.pass = false;
  } else if (row.op === "DIR" || row.op === "LOAD") {
    const bytes = [...readFileSync(testDisk)];
    const fileName = "boulder-dash.d64";
    await ensureLibraryFixture(page, fileName, bytes);
    await insertFloppyViaLibraryUI(page, { filePath: testDisk, fileName, unit: row.pairFrom });
    await waitRunning(page, 120_000);
    await page.waitForTimeout(2000);
    await page.evaluate(async (u) => window.__g64?.iecBusReconcile?.(u), row.pairFrom);
    await page.waitForTimeout(1500);
    const busSnap = await captureViceDriveBus(page);
    Object.assign(rec, busSnap);
    rec.coreBuildIdExpected = expectedCoreBuildId;
    const serialLabel = busSnap.viceDriveBus?.serialDeviceLabel;
    if (busSnap.coreBuildIdLoaded && busSnap.coreBuildIdLoaded !== expectedCoreBuildId) {
      rec.pass = false;
      rec.reason = `stale core ${busSnap.coreBuildIdLoaded} (want ${expectedCoreBuildId})`;
      rec.skipped = false;
    } else if (serialLabel === "virt") {
      rec.pass = false;
      rec.reason = "viceDriveBus.serialDeviceLabel=virt (KERNAL still on virtual IEC traps)";
      rec.skipped = false;
    } else {
      const smoke =
        row.op === "DIR"
          ? await dirOnUnit(page, row.pairFrom)
          : await loadSmokeOnUnit(page, row.pairFrom);
      rec.pass = row.op === "DIR" ? smoke.ok : smoke.loadOk;
      rec.textHead = smoke.textHead;
      rec.listHead = smoke.listHead;
      if (row.op === "LOAD") {
        rec.prg = smoke.prg;
        rec.afterHead = smoke.afterHead;
        if (!rec.pass) rec.reason = smoke.reason ?? "named LOAD failed";
      }
    }
  } else if (row.op === "COPY") {
    rec.skipped = true;
    rec.reason = "COPY A↔B harness TBD — LOAD/DIR smoke only in first unpark slice";
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
