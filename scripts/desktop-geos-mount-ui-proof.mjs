#!/usr/bin/env node
/**
 * Real UI: library GEOS Run must finish mount (no frozen boot overlay), LIST, GEOS deskTop.
 * Jiffy + 2MB REU. About/Settings close on Escape. Screenshots under screenshots/geos-mount-proof-*
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { patchLocalStorage, powerOnDesktop, typeBasic, waitRunning } from "./desktop-qa-lib.mjs";
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

async function waitBootClear(page, ms = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const booting = await page.evaluate(() => window.__g64?.booting?.() ?? false);
    if (!booting) return true;
    await page.waitForTimeout(500);
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
}

async function runFromLibrary(page, label) {
  await page.locator('button[aria-label="Software"]').click({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /On this device/i }).click();
  await page.waitForTimeout(300);
  const esc = d64Name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page.getByRole("button", { name: new RegExp(`^(Play|Run) ${esc}$`) }).first().click({ timeout: 30_000 });
  await waitRunning(page, 180_000);
  const cleared = await waitBootClear(page, 150_000);
  await page.screenshot({ path: join(shotDir, `${label}-after-run.png`), fullPage: true });
  return cleared;
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

  await page.locator('button[aria-label="About"]').click({ timeout: 10_000 });
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const aboutGone = await page.evaluate(() => {
    const sheets = [...document.querySelectorAll(".g64-sheet")];
    return sheets.every((el) => el.getAttribute("data-state") !== "open");
  });
  report.steps.push({ id: "about-escape", pass: aboutGone });
  await page.screenshot({ path: join(shotDir, "about-escape.png"), fullPage: true });

  await importOnce(page);
  const mountCleared = await runFromLibrary(page, "first-run");
  const logs = await page.evaluate(() => (window.__g64log ?? []).filter((l) => /mount-stage|play-mount|floppy-mount/.test(l)));
  const diag = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
  report.steps.push({
    id: "mount-clears-overlay",
    pass: mountCleared,
    diskExportsPresent: diag?.diskExportsPresent,
    booting: await page.evaluate(() => window.__g64?.booting?.()),
    mountLogs: logs.slice(-12),
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
    (screen.replace(/\s+/g, "").length > 120 || /GEOS|DESK|DISK/i.test(screen));
  await page.screenshot({ path: join(shotDir, "geos-desktop.png"), fullPage: true });
  report.steps.push({ id: "geos-desktop", pass: geosOk });

  await importOnce(page);
  const secondRun = await runFromLibrary(page, "second-run-existing-library");
  report.steps.push({ id: "second-run-mount", pass: secondRun });

  report.pass = report.steps.every((s) => s.pass);
  writeFileSync(join(process.cwd(), "artifacts", "geos-mount-ui-proof.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
} catch (e) {
  report.error = String(e?.message || e);
  console.error(e);
  process.exit(1);
} finally {
  await browser.close();
}
