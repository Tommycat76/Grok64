#!/usr/bin/env node
/**
 * Tom hand path on GEOS_2.0.d64 (175531 bytes: a D64 with an error-info table), once per
 * JiffyDOS mode in a fresh browser context: reused profile, library row Insert on unit 8,
 * then with Playwright trusted keys LOAD"$",8 + LIST and LOAD"GEOS",8,1 + RUN until the
 * GEOS deskTop is on screen.
 *
 *   node scripts/desktop-geos-insert-tom-hand-repro.mjs
 *   GROK64_TOM_JIFFY=off,on   GROK64_TOM_TYPING_MS=400   GROK64_TOM_GEOS_STRICT=1 (Tom's sha1 only)
 *
 * GEOS_2.0.d64 is a copy of the real image (GROK64_GEOS_D64_PATH or private-c64/geos); without
 * it, or when it carries no error codes, the run skips. The library is seeded through a QA
 * hook in a headless browser, so this is a diagnostic: the hand gate is
 * scripts/desktop-xdotool-geos-hand-boot.mjs.
 * Screenshots under screenshots/geos-insert-tom-hand/<jiffy-off|jiffy-on>/.
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  assertGrok64WasmCore,
  clearEmulatorJsCache,
  grok64DatapathFromEnv,
  installGrok64CoreNetworkGuard,
} from "./desktop-grok64-core.mjs";
import {
  assertSessionFlags,
  geosDirectoryOnScreen,
  patchLocalStorage,
  seedTomReusedProfile,
  powerOnDesktop,
  waitBasicCommand,
  waitForG64,
  waitGeosBoot,
  typeC64RealKeyboard,
  waitRunning,
} from "./desktop-qa-lib.mjs";
import {
  GEOS_D64_EXPECTED_BYTES,
  TOM_GEOS_D64_SHA1_PREFIX,
  geosD64Fingerprint,
} from "./geos-fixture-lib.mjs";
import { d64ErrorInfoSummary } from "./d64-error-info-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const keyMs = Number(process.env.GROK64_TOM_TYPING_MS || "400");
const jiffyModes = (process.env.GROK64_TOM_JIFFY || "off,on").split(",").map((s) => s.trim() === "on");
const deskTopMs = Number(process.env.GROK64_TOM_DESKTOP_MS || "240000");
const shotDir = join(process.cwd(), "screenshots", "geos-insert-tom-hand");
const outDir = join(process.cwd(), "artifacts", "geos-insert-tom-hand");
mkdirSync(shotDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

spawnSync(process.execPath, ["scripts/prepare-floppy-fixtures.mjs"], { stdio: "inherit" });
const d64Path = join(process.cwd(), "fixtures", "geos", "GEOS_2.0.d64");
if (!grok64DatapathFromEnv() || !existsSync(d64Path)) {
  console.log(JSON.stringify({ pass: false, skipped: true }));
  process.exit(0);
}

const d64Name = "GEOS_2.0.d64";
const d64Bytes = readFileSync(d64Path);
const d64Fp = geosD64Fingerprint(d64Bytes);
const d64B64 = d64Bytes.toString("base64");
const run = {
  keyMs,
  path: "library-row-insert-unit-8",
  librarySeed: "importLibraryBytes-no-ui-import",
  geosD64: d64Fp,
  geosD64Expect: { bytes: GEOS_D64_EXPECTED_BYTES, sha1Prefix: TOM_GEOS_D64_SHA1_PREFIX },
  errorInfo: d64ErrorInfoSummary(d64Bytes),
  modes: [],
};
const skip = (reason) => {
  console.log(JSON.stringify({ pass: false, skipped: true, reason, geosD64: d64Fp }));
  process.exit(0);
};
if (d64Fp.bytes !== GEOS_D64_EXPECTED_BYTES) skip("wrong-geos-bytes");
if (process.env.GROK64_TOM_GEOS_STRICT === "1" && !d64Fp.tomHand) skip("not-tom-geos-sha");
if (!d64Fp.errorCodes) skip("no-error-codes");

async function typeTomKeyboard(page, text) {
  await typeC64RealKeyboard(page, text, { keyDelayMs: keyMs, lineEndMs: Math.max(1200, keyMs * 2) });
  await page.waitForTimeout(keyMs);
}

async function clearScreenKeys(page) {
  await page.keyboard.down("Shift");
  await page.keyboard.press("Home", { delay: 120 });
  await page.keyboard.up("Shift");
  await page.waitForTimeout(600);
}

async function screenText(page) {
  return page.evaluate(() => window.__g64?.screenText?.() ?? "");
}

async function openSoftwareLibraryTab(page, trace) {
  await page.locator('button[aria-label="Software"]').first().click({ timeout: 15_000, force: true });
  const sheetVisible = await page
    .locator(".g64-sheet")
    .waitFor({ state: "visible", timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  if (!sheetVisible) {
    trace.softwareOpen = "api-fallback";
    await page.evaluate(() => window.__g64?.openSoftwareLibrary?.() ?? window.__g64?.openSoftware?.());
  } else {
    trace.softwareOpen = "toolbar-click";
  }
  await page.evaluate(() => window.__g64?.openSoftwareLibrary?.());
  await page.locator(".g64-seg button").filter({ hasText: /^On this device/ }).click({ force: true }).catch(() => {});
  await page.locator(".g64-sheet").waitFor({ state: "visible", timeout: 15_000 });
  await page.locator("button.g64-btn").filter({ hasText: /^Import$/ }).first().waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(200);
}

/** Tom's disk is already in On this device — UI Import would autostart GEOS via runSaved(). */
async function seedLibraryQuiet(page) {
  await page.evaluate(async ({ name, b64 }) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.__g64?.importLibraryBytes?.(name, bin);
  }, { name: d64Name, b64: d64B64 });
  await page.waitForTimeout(400);
}

async function insertLibraryRowUnit8(page, trace, shot) {
  trace.insertRunning = await page.evaluate(() => window.__g64?.running?.());
  await openSoftwareLibraryTab(page, trace);
  const card = page.locator(".g64-card").filter({ hasText: d64Name }).first();
  await card.waitFor({ state: "visible", timeout: 30_000 });
  await card.scrollIntoViewIfNeeded({ timeout: 15_000 });
  await card
    .getByRole("group", { name: /IEC drive unit/i })
    .getByRole("button", { name: "8", exact: true })
    .click({ force: true, timeout: 15_000 });
  await page.waitForTimeout(300);
  const insertBtn = page.getByRole("button", { name: `Insert ${d64Name}`, exact: true });
  await insertBtn.waitFor({ state: "visible", timeout: 30_000 });
  await insertBtn.scrollIntoViewIfNeeded().catch(() => {});
  await shot("01-library-row.png");
  await insertBtn.click({ timeout: 60_000, force: true });
  await waitRunning(page, 180_000);
  await page.waitForTimeout(5000);
  trace.postInsertDiag = await page.evaluate(async () => {
    const d = await window.__g64?.attachDiskDiag?.();
    return {
      viceLastReattach: d?.viceLastReattach,
      viceDriveBus: d?.viceDriveBus,
    };
  });
  await shot("02-after-insert.png");
}

async function runMode(browser, jiffy) {
  const mode = jiffy ? "jiffy-on" : "jiffy-off";
  const dir = join(shotDir, mode);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const trace = { mode, jiffy };
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const shot = (name) => page.screenshot({ path: join(dir, name), fullPage: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e?.message || e)));
  await installGrok64CoreNetworkGuard(page, base);
  try {
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await clearEmulatorJsCache(page);
    await seedTomReusedProfile(page, { jiffyDos: jiffy });
    await patchLocalStorage(page, {
      video: "auto",
      jiffy,
      reu: "2048kB",
      drive: "cmd-layout",
      machineId: "c64-auto",
      coreMode: "auto",
      driveMode: "auto",
      mouse: true,
      scpuSimm: "16",
      scpuTurbo: true,
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForG64(page);
    await powerOnDesktop(page, base, { navigate: false });
    await waitRunning(page, 120_000);
    await assertGrok64WasmCore(page, { timeoutMs: 120_000 });
    trace.sessionFlags = await assertSessionFlags(page, { mouseMode: true, reuSize: "2048kB" });
    trace.jiffyLive = await page.evaluate(() => window.__g64?.jiffyLive?.() ?? null);
    await shot("00-powered-on.png");

    await seedLibraryQuiet(page);
    await insertLibraryRowUnit8(page, trace, shot);

    await clearScreenKeys(page);
    await typeTomKeyboard(page, 'LOAD"$",8');
    trace.loadDollar = await waitBasicCommand(page, 'LOAD"$",8', 90_000);
    const diag = await page.evaluate(() => window.__g64?.captureLoadDollarDiag?.(8) ?? null);
    trace.errorInfoInCore = diag?.errorInfo ?? null;
    trace.tdeImageBytes = diag?.tdeImageBytes ?? null;
    trace.imgBamDiskName = diag?.imgBamDiskName ?? null;
    await shot("03-load-dollar.png");

    await typeTomKeyboard(page, "LIST");
    const t0 = Date.now();
    let listed = "";
    while (Date.now() - t0 < 40_000) {
      await page.waitForTimeout(1000);
      listed = await screenText(page);
      if (/BLOCKS FREE|FILE NOT FOUND/i.test(listed)) break;
    }
    await page.waitForTimeout(1500);
    listed = await screenText(page);
    await shot("04-list.png");
    trace.directoryOk = !trace.loadDollar.error && geosDirectoryOnScreen(listed) && /BLOCKS FREE/i.test(listed);
    trace.listScreen = listed.slice(0, 600);

    await clearScreenKeys(page);
    await typeTomKeyboard(page, 'LOAD"GEOS",8,1');
    let nextShot = 20_000;
    const boot = await waitGeosBoot(page, {
      typeRun: async () => {
        await shot("05-load-geos-ready.png");
        await typeTomKeyboard(page, "RUN");
      },
      deskTopMs,
      onTick: async (ms) => {
        if (ms < nextShot) return;
        await shot(`06-booting-${Math.round(nextShot / 1000)}s.png`);
        nextShot += 30_000;
      },
    });
    trace.loadGeos = boot.load;
    trace.run = boot.run;
    trace.deskTop = boot.deskTop;
    await page.waitForTimeout(1500);
    await shot("07-desktop.png");
    trace.pageErrors = errors.slice(0, 5);
    trace.pass = Boolean(trace.directoryOk && !trace.loadGeos?.error && trace.deskTop?.pass);
  } catch (e) {
    trace.error = String(e?.message || e);
    trace.pass = false;
    await shot("99-error.png").catch(() => {});
  } finally {
    await page.close().catch(() => {});
  }
  return trace;
}

const browser = await chromium.launch({ headless: true });
try {
  for (const jiffy of jiffyModes) {
    const trace = await runMode(browser, jiffy);
    run.modes.push(trace);
    console.log(
      JSON.stringify({
        mode: trace.mode,
        pass: trace.pass,
        jiffyLive: trace.jiffyLive,
        directoryOk: trace.directoryOk,
        loadDollarMs: trace.loadDollar?.ms,
        loadGeos: trace.loadGeos,
        run: trace.run,
        deskTop: trace.deskTop && { pass: trace.deskTop.pass, ms: trace.deskTop.ms },
        errorInfoInCore: trace.errorInfoInCore && {
          track18: trace.errorInfoInCore.track18,
          flaggedCount: trace.errorInfoInCore.flaggedCount,
        },
        error: trace.error,
      }),
    );
  }
} finally {
  await browser.close();
}
run.pass = run.modes.length > 0 && run.modes.every((m) => m.pass);
writeFileSync(join(outDir, "trace.json"), JSON.stringify(run, null, 2));
console.log(JSON.stringify({ pass: run.pass, geosD64: d64Fp, modes: run.modes.map((m) => [m.mode, m.pass]) }));
process.exit(run.pass ? 0 : 1);
