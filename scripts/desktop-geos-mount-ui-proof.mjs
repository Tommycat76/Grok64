#!/usr/bin/env node
/**
 * Real UI from LIVE Jiffy READY + existing library (hot-swap Play path Tom uses).
 * Jiffy on, REU 2MB. GEOS D64 dir + deskTop; second library Run; About Escape.
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { patchLocalStorage, powerOnDesktop, typeBasic, waitRunning, waitForG64 } from "./desktop-qa-lib.mjs";
import { assertGrok64WasmCore, clearEmulatorJsCache, grok64DatapathFromEnv } from "./desktop-grok64-core.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const shotDir = join(process.cwd(), "screenshots", "geos-mount-proof");
mkdirSync(shotDir, { recursive: true });
mkdirSync(join(process.cwd(), "artifacts"), { recursive: true });

spawnSync(process.execPath, ["scripts/prepare-floppy-fixtures.mjs"], { stdio: "inherit" });

const d64Path =
  process.env.GROK64_GEOS_D64_PATH ||
  (existsSync(join(process.cwd(), "fixtures", "geos", "GEOS_2.0.d64"))
    ? join(process.cwd(), "fixtures", "geos", "GEOS_2.0.d64")
    : null);

if (!d64Path || !grok64DatapathFromEnv()) {
  console.log(JSON.stringify({ pass: false, skipped: true, reason: "missing d64 or datapath" }));
  process.exit(0);
}

const d64Name = d64Path.split("/").pop() ?? "GEOS_2.0.d64";

async function waitBootClear(page, ms = 150_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const booting = await page.evaluate(() => window.__g64?.booting?.() ?? false);
    if (!booting) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

async function waitJiffyReady(page, ms = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const t = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
    if (/JIFFYDOS/i.test(t) && /\bREADY\b/i.test(t)) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

async function importOnce(page) {
  await page.locator('button[aria-label="Software"]').click({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /On this device/i }).click();
  await page.waitForTimeout(300);
  await page.locator('input[type="file"]').setInputFiles(d64Path);
  await page.waitForTimeout(1500);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
}

async function runFromLibrary(page, label) {
  await page.locator('button[aria-label="Software"]').click({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /On this device/i }).click();
  await page.waitForTimeout(300);
  const esc = d64Name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page.getByRole("button", { name: new RegExp(`^(Play|Run) ${esc}$`) }).first().click({ timeout: 30_000 });
  await waitRunning(page, 180_000);
  const cleared = await waitBootClear(page);
  const logs = await page.evaluate(() =>
    (window.__g64log ?? []).filter((l) => /mount-stage|mount-fail|hot-swap|gcr-hot/.test(l)),
  );
  const overflow = logs.some((l) => /Maximum call stack|RangeError/i.test(l));
  await page.screenshot({ path: join(shotDir, `${label}-after-run.png`), fullPage: true });
  return { cleared, overflow, logs: logs.slice(-16) };
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const report = { steps: [] };

try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  if (process.env.GROK64_CLEAR_EJS_CACHE === "1") await clearEmulatorJsCache(page);
  await patchLocalStorage(page, { video: "pal", jiffy: true, reu: "2048kB" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
  await assertGrok64WasmCore(page);
  const jiffyLive = await waitJiffyReady(page);
  await page.screenshot({ path: join(shotDir, "jiffy-ready-live.png"), fullPage: true });
  report.steps.push({ id: "live-jiffy-ready", pass: jiffyLive });

  await page.locator('button[aria-label="About"]').click({ timeout: 10_000 });
  await page.waitForTimeout(300);
  await page.locator('button[aria-label="Settings"]').click({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const overlaysClosed = await page.evaluate(() => {
    const sheets = [...document.querySelectorAll(".g64-sheet")];
    return sheets.every((el) => el.getAttribute("data-state") !== "open");
  });
  report.steps.push({ id: "escape-closes-sheets", pass: overlaysClosed });

  await importOnce(page);
  const first = await runFromLibrary(page, "hot-swap-run");
  const diag = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
  const attached = typeof diag?.viceAttachedImage === "string" ? diag.viceAttachedImage : "";
  const attachOk =
    diag?.viceLastReattach?.rc === 0 &&
    attached.length > 0 &&
    !/\/blank\.d64$/i.test(attached) &&
    !/^work\s*disk/i.test(attached);
  const bindOk =
    diag?.workDiskRefreshExport === true &&
    diag?.grok64WasmBindRev === "diskapi-v2-direct" &&
    diag?.diskAttachExport === true;
  report.steps.push({
    id: "hot-swap-mount",
    pass: first.cleared && !first.overflow && attachOk && bindOk,
    diskExportsPresent: diag?.diskExportsPresent,
    workDiskRefreshExport: diag?.workDiskRefreshExport,
    diskAttachExport: diag?.diskAttachExport,
    wasmExportNames: diag?.wasmExportNames,
    grok64WasmBindRev: diag?.grok64WasmBindRev,
    appBuildId: diag?.appBuildId,
    viceAttachedImage: diag?.viceAttachedImage,
    viceLastReattach: diag?.viceLastReattach,
    ...first,
  });

  await typeBasic(page, 'LOAD"$",8', { afterMs: 12_000 });
  await page.waitForTimeout(3000);
  await typeBasic(page, "LIST", { afterMs: 10_000 });
  await page.waitForTimeout(2000);
  const list = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  await page.screenshot({ path: join(shotDir, "list.png"), fullPage: true });
  const listOk = /GEOS/i.test(list) && !/FILE NOT FOUND/i.test(list);
  report.steps.push({ id: "list", pass: listOk });

  await typeBasic(page, 'LOAD"GEOS",8,1', { afterMs: 35_000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.__g64?.feedBasic?.("RUN"));
  await page.waitForTimeout(18_000);
  const screen = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  const geosOk =
    !/FILE NOT FOUND/i.test(screen) &&
    !/COMMODORE 64 BASIC V2/i.test(screen) &&
    screen.replace(/\s+/g, "").length > 120;
  await page.screenshot({ path: join(shotDir, "geos-desktop.png"), fullPage: true });
  report.steps.push({ id: "geos-desktop", pass: geosOk });

  const second = await runFromLibrary(page, "second-library-run");
  report.steps.push({ id: "second-run", pass: second.cleared && !second.overflow });

  report.pass = report.steps.every((s) => s.pass);
  writeFileSync(join(process.cwd(), "artifacts", "geos-mount-ui-proof.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
} catch (e) {
  report.error = String(e?.message || e);
  writeFileSync(join(process.cwd(), "artifacts", "geos-mount-ui-proof.json"), JSON.stringify(report, null, 2));
  console.error(e);
  process.exit(1);
} finally {
  await browser.close();
}
