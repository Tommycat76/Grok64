#!/usr/bin/env node
/**
 * Library floppy UI gate — real import (file picker), Run + Insert.
 * D64: GEOS_2.0.d64 (175531 with error bytes). G64: fixtures/geos/*.g64 or GROK64_GEOS_G64_PATH.
 * Jiffy on/off, 2MB REU. Screenshots: screenshots/library-floppy-ui-*
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  patchLocalStorage,
  powerOnDesktop,
  typeBasic,
  waitRunning,
} from "./desktop-qa-lib.mjs";
import { assertGrok64WasmCore, clearEmulatorJsCache, grok64DatapathFromEnv } from "./desktop-grok64-core.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const shotDir = join(process.cwd(), "screenshots");
mkdirSync(shotDir, { recursive: true });

spawnSync(process.execPath, ["scripts/prepare-floppy-fixtures.mjs"], { stdio: "inherit" });

const d64Path =
  process.env.GROK64_GEOS_D64_PATH ||
  (existsSync(join(process.cwd(), "fixtures", "geos", "GEOS_2.0.d64"))
    ? join(process.cwd(), "fixtures", "geos", "GEOS_2.0.d64")
    : null);
const g64Path =
  process.env.GROK64_GEOS_G64_PATH ||
  [join(process.cwd(), "fixtures", "geos", "324_D1_Geos.g64"), join(process.cwd(), "fixtures", "geos", "GEOS.g64")]
    .find((p) => existsSync(p)) ||
  null;

if (!d64Path || !existsSync(d64Path)) {
  console.log(JSON.stringify({ pass: false, skipped: true, reason: "missing GEOS_2.0.d64 — run prepare-floppy-fixtures" }));
  process.exit(0);
}
const requireG64 = process.env.GROK64_SKIP_G64 !== "1";
if (requireG64 && !g64Path) {
  console.log(
    JSON.stringify({
      pass: false,
      reason: "missing .g64 — set GROK64_GEOS_G64_PATH (e.g. 324_D1_Geos.g64) or GROK64_SKIP_G64=1 for D64-only",
      d64Path,
    }),
  );
  process.exit(1);
}
if (!grok64DatapathFromEnv()) {
  console.error("VITE_GROK64_VICE_DATAPATH missing");
  process.exit(1);
}

const d64Bytes = readFileSync(d64Path);
const d64Sha1 = createHash("sha1").update(d64Bytes).digest("hex");
const d64Name = d64Path.split("/").pop() ?? "GEOS_2.0.d64";

async function importViaFilePicker(page, filePath) {
  await page.locator('button[aria-label="Software"]').click({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /On this device/i }).click();
  await page.waitForTimeout(300);
  await page.locator('input[type="file"]').setInputFiles(filePath);
  await page.waitForTimeout(1500);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
}

async function runLibraryDisk(page, fileName) {
  await page.locator('button[aria-label="Software"]').click({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /On this device/i }).click();
  await page.waitForTimeout(300);
  const esc = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page.getByRole("button", { name: new RegExp(`^(Play|Run) ${esc}$`) }).click({ timeout: 30_000 });
  await waitRunning(page, 180_000);
  await page.waitForTimeout(6000);
  await page.keyboard.press("Escape").catch(() => {});
}

async function insertLibraryDisk(page, fileName) {
  await page.evaluate(() => window.__g64?.resetReady?.());
  await waitRunning(page, 120_000);
  await page.waitForTimeout(1500);
  await page.locator('button[aria-label="Software"]').click({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /On this device/i }).click();
  await page.waitForTimeout(300);
  const esc = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page.getByRole("button", { name: new RegExp(`^Insert ${esc}$`) }).click({ timeout: 30_000 });
  await waitRunning(page, 120_000);
  await page.waitForTimeout(6000);
  await page.keyboard.press("Escape").catch(() => {});
}

async function listText(page) {
  await typeBasic(page, 'LOAD"$",8', { afterMs: 12_000 });
  await page.waitForTimeout(4000);
  await typeBasic(page, "LIST", { afterMs: 10_000 });
  await page.waitForTimeout(2500);
  return await page.evaluate(() => window.__g64?.screenText?.() || "");
}

const jiffyModes = (process.env.JIFFY_MODE || "on,off").split(",").map((s) => s.trim());
const report = { d64Sha1, d64Size: d64Bytes.byteLength, g64Path, rows: [] };

for (const jiffyTag of jiffyModes) {
  const jiffyOn = jiffyTag === "on";
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await clearEmulatorJsCache(page);
  await patchLocalStorage(page, { video: "pal", jiffy: jiffyOn, reu: "2048kB" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
  await assertGrok64WasmCore(page, { timeoutMs: 120_000 });

  await importViaFilePicker(page, d64Path);
  await runLibraryDisk(page, d64Name);
  const diagD64 = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
  const listD64 = await listText(page);
  await page.screenshot({ path: join(shotDir, `library-floppy-ui-${jiffyTag}-d64-list.png`), fullPage: true });
  const d64DirOk =
    !/FILE NOT FOUND|DEVICE NOT PRESENT/i.test(listD64) &&
    (/GEOS/i.test(listD64) || /47454f53/i.test(diagD64?.session?.dir18s1Hex ?? ""));
  const d64ShaOk = diagD64?.session?.sha1 === d64Sha1 && diagD64?.session?.size === d64Bytes.byteLength;
  const vicePath =
    diagD64?.viceAttachedImage ||
    diagD64?.viceLastReattach?.path ||
    null;
  const d64ViceAttachOk =
    diagD64?.viceDiskExports === true &&
    typeof vicePath === "string" &&
    vicePath.length > 0 &&
    !/WORK DISK/i.test(vicePath) &&
    (diagD64?.viceLastReattach?.rc === 0 || Boolean(diagD64?.viceAttachedImage));

  await typeBasic(page, 'LOAD"GEOS",8,1', { afterMs: 35_000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.__g64?.feedBasic?.("RUN"));
  await page.waitForTimeout(12_000);
  const afterGeos = await page.evaluate(() => window.__g64?.screenText?.() || "");
  await page.screenshot({ path: join(shotDir, `library-floppy-ui-${jiffyTag}-d64-geos-run.png`), fullPage: true });
  const geosBootOk = !/FILE NOT FOUND/i.test(afterGeos) && afterGeos.length > 40;

  let g64Row = { skipped: true, reason: "no g64 fixture" };
  if (g64Path) {
    const g64Name = g64Path.split("/").pop() ?? "GEOS.g64";
    const g64Bytes = readFileSync(g64Path);
    const g64Sha1 = createHash("sha1").update(g64Bytes).digest("hex");
    await importViaFilePicker(page, g64Path);
    await runLibraryDisk(page, g64Name);
    const diagG64 = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
    const listG64 = await listText(page);
    await page.screenshot({ path: join(shotDir, `library-floppy-ui-${jiffyTag}-g64-run-list.png`), fullPage: true });
    const g64ListOk = /GEOS/i.test(listG64) && !/^\s*0\s+"WORK DISK"/m.test(listG64);
    const g64Boot = (diagG64?.bootFile || "").toLowerCase().endsWith(".g64");
    const g64ShaOk = diagG64?.session?.sha1 === g64Sha1;

    await insertLibraryDisk(page, g64Name);
    const diagIns = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
    const listIns = await listText(page);
    await page.screenshot({ path: join(shotDir, `library-floppy-ui-${jiffyTag}-g64-insert-list.png`), fullPage: true });
    const insOk = /GEOS/i.test(listIns) && !/FILE NOT FOUND/i.test(listIns);

    g64Row = {
      g64Name,
      g64ShaOk,
      g64Boot,
      g64ListOk,
      insertListOk: insOk,
      bootFile: diagG64?.bootFile,
      pass: g64Boot && g64ShaOk && g64ListOk && insOk,
    };
  }

  report.rows.push({
    jiffy: jiffyTag,
    d64: {
      pass: d64ShaOk && d64DirOk && geosBootOk,
      viceAttachGate: d64ViceAttachOk,
      d64ShaOk,
      d64DirOk,
      d64ViceAttachOk,
      geosBootOk,
      diag: diagD64,
    },
    g64: g64Row,
  });
  await browser.close();
}

report.pass = report.rows.every(
  (r) => r.d64.pass && (!requireG64 || (!r.g64.skipped && r.g64.pass)),
);
console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);
