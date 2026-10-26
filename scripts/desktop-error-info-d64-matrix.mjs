#!/usr/bin/env node
/**
 * Error-info D64 matrix on the Tom hand path: library row Insert (unit 8),
 * LOAD"$",8 + LIST with Playwright trusted keys. On failure the real 1541
 * error channel is read from BASIC (OPEN1,8,15 / INPUT#1).
 *
 *   GROK64_D64_LIST=/a.d64,/b.d64 node scripts/desktop-error-info-d64-matrix.mjs
 *   GROK64_D64_DIR=/dir (all *.d64)    GROK64_JIFFY=1    GROK64_FRESH_BOOT=1
 *   GROK64_LOAD_NAME=GEOS  -> also LOAD"GEOS",8,1 after the directory (RUN when READY.
 *                             returns), passing only once the GEOS deskTop is on screen
 */
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  assertGrok64WasmCore,
  clearEmulatorJsCache,
  grok64DatapathFromEnv,
  installGrok64CoreNetworkGuard,
} from "./desktop-grok64-core.mjs";
import {
  assertSessionFlags,
  patchLocalStorage,
  powerOnDesktop,
  seedTomReusedProfile,
  typeC64RealKeyboard,
  waitBasicCommand,
  waitForG64,
  waitGeosBoot,
  waitRunning,
} from "./desktop-qa-lib.mjs";
import { d64ErrorInfoSummary } from "./d64-error-info-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const keyMs = Number(process.env.GROK64_KEY_MS || "120");
const jiffy = process.env.GROK64_JIFFY === "1";
const freshBoot = process.env.GROK64_FRESH_BOOT === "1";
const loadName = process.env.GROK64_LOAD_NAME || "";
const tag = process.env.GROK64_MATRIX_TAG || (jiffy ? "jiffy" : "stock");
const shotDir = join(process.cwd(), "screenshots", "error-info-d64", tag);
const outDir = join(process.cwd(), "artifacts", "error-info-d64");
mkdirSync(shotDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

function listDisks() {
  if (process.env.GROK64_D64_LIST) {
    return process.env.GROK64_D64_LIST.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  }
  const dir = process.env.GROK64_D64_DIR;
  if (dir && existsSync(dir)) {
    return readdirSync(dir)
      .filter((f) => /\.d64$/i.test(f))
      .sort()
      .map((f) => join(dir, f));
  }
  return [];
}

const disks = listDisks().filter((p) => existsSync(p));
if (!grok64DatapathFromEnv() || !disks.length) {
  console.log(JSON.stringify({ pass: false, skipped: true, reason: "no-disks-or-core" }));
  process.exit(0);
}

function shortName(p, i) {
  const raw = basename(p).replace(/[^A-Za-z0-9._-]+/g, "_");
  const trimmed = raw.length > 28 ? raw.slice(-28) : raw;
  return `E${String(i).padStart(2, "0")}_${trimmed.replace(/^_+/, "")}`.replace(/\.d64$/i, "") + ".d64";
}

async function bootTom(page) {
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
  await assertSessionFlags(page, { mouseMode: true, reuSize: "2048kB" });
}

async function openLibrary(page) {
  await page.locator('button[aria-label="Software"]').first().click({ timeout: 15_000, force: true }).catch(() => {});
  await page.evaluate(() => window.__g64?.openSoftwareLibrary?.());
  await page.locator(".g64-seg button").filter({ hasText: /^On this device/ }).click({ force: true }).catch(() => {});
  await page.locator(".g64-sheet").waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(200);
}

async function insertRowUnit8(page, name) {
  await openLibrary(page);
  const card = page.locator(".g64-card").filter({ hasText: name }).first();
  await card.waitFor({ state: "visible", timeout: 30_000 });
  await card.scrollIntoViewIfNeeded({ timeout: 15_000 });
  await card
    .getByRole("group", { name: /IEC drive unit/i })
    .getByRole("button", { name: "8", exact: true })
    .click({ force: true, timeout: 15_000 });
  await page.waitForTimeout(300);
  const insertBtn = page.getByRole("button", { name: `Insert ${name}`, exact: true });
  await insertBtn.waitFor({ state: "visible", timeout: 30_000 });
  await insertBtn.scrollIntoViewIfNeeded().catch(() => {});
  await insertBtn.click({ timeout: 60_000, force: true });
  await waitRunning(page, 180_000);
  await page.waitForTimeout(2500);
}

async function clearScreen(page) {
  await page.evaluate(async () => {
    await window.__g64?.typeBasic?.("PRINTCHR$(147)", { delayMs: 40 });
  });
  await page.waitForTimeout(800);
}

async function readDriveErrorChannel(page) {
  await clearScreen(page);
  await page.evaluate(async () => {
    await window.__g64?.typeBasic?.("OPEN1,8,15:INPUT#1,A,B$,C,D:CLOSE1:PRINT\"DOS\";A;B$;C;D", {
      delayMs: 40,
    });
  });
  const t0 = Date.now();
  let text = "";
  while (Date.now() - t0 < 20_000) {
    await page.waitForTimeout(700);
    text = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
    const m = text.match(/DOS\s+(\d+)\s*([^\n]*)/);
    if (m) return { code: Number(m[1]), text: m[0].trim() };
  }
  return { code: null, text: text.slice(0, 200) };
}

const browser = await chromium.launch({ headless: true });
const results = [];
let page = null;

async function newBootedPage() {
  if (page) await page.close().catch(() => {});
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await installGrok64CoreNetworkGuard(page, base);
  await bootTom(page);
}

try {
  await newBootedPage();
  for (let i = 0; i < disks.length; i++) {
    const path = disks[i];
    const bytes = readFileSync(path);
    const name = shortName(path, i);
    const row = {
      i,
      path,
      name,
      bytes: bytes.byteLength,
      sha1: createHash("sha1").update(bytes).digest("hex"),
      errorInfo: d64ErrorInfoSummary(bytes),
    };
    try {
      if (freshBoot && i > 0) await newBootedPage();
      await page.evaluate(async ({ n, b64 }) => {
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        await window.__g64?.importLibraryBytes?.(n, bin);
      }, { n: name, b64: bytes.toString("base64") });
      await page.waitForTimeout(300);
      await insertRowUnit8(page, name);
      await clearScreen(page);
      const t0 = Date.now();
      await typeC64RealKeyboard(page, 'LOAD"$",8', { keyDelayMs: keyMs, lineEndMs: Math.max(800, keyMs * 2) });
      const lw = await waitBasicCommand(page, 'LOAD"$",8', 90_000);
      row.loadMs = Date.now() - t0;
      row.loadError = lw.error;
      row.diag = await page.evaluate(() => window.__g64?.captureLoadDollarDiag?.(8) ?? null);
      let screen = "";
      if (!lw.error) {
        await typeC64RealKeyboard(page, "LIST", { keyDelayMs: keyMs, lineEndMs: 1500 });
        const tl = Date.now();
        while (Date.now() - tl < 30_000 && !/BLOCKS FREE/i.test(screen)) {
          await page.waitForTimeout(1000);
          screen = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
        }
      }
      screen = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
      row.screen = screen.slice(0, 600);
      row.listed = /BLOCKS FREE/i.test(screen) && !/FILE NOT FOUND/i.test(screen);
      await page.screenshot({ path: join(shotDir, `${String(i).padStart(2, "0")}-list.png`) });
      if (!row.listed) row.driveError = await readDriveErrorChannel(page);
      if (loadName && row.listed) {
        await clearScreen(page);
        const command = `LOAD"${loadName}",8,1`;
        await typeC64RealKeyboard(page, command, { keyDelayMs: keyMs, lineEndMs: 1200 });
        if (/^GEOS$/i.test(loadName)) {
          const boot = await waitGeosBoot(page, {
            command,
            typeRun: () => typeC64RealKeyboard(page, "RUN", { keyDelayMs: keyMs, lineEndMs: 800 }),
          });
          row.loadNamed = {
            error: boot.load.error || !boot.deskTop?.pass,
            load: boot.load,
            run: boot.run,
            deskTop: Boolean(boot.deskTop?.pass),
            ms: boot.deskTop?.ms ?? boot.load.ms,
          };
        } else {
          const lw2 = await waitBasicCommand(page, command, 120_000);
          row.loadNamed = { error: lw2.error, load: lw2 };
        }
        await page.screenshot({ path: join(shotDir, `${String(i).padStart(2, "0")}-${loadName.toLowerCase()}.png`) });
        if (row.loadNamed.load.error) row.loadNamed.driveError = await readDriveErrorChannel(page);
      }
    } catch (e) {
      row.exception = String(e?.message || e);
    }
    results.push(row);
    console.log(
      JSON.stringify({
        i,
        name,
        listed: row.listed,
        loadError: row.loadError,
        driveError: row.driveError?.text ?? null,
        codes: row.errorInfo?.histogram,
        t18: row.errorInfo?.track18,
        loadNamed: row.loadNamed
          ? { error: row.loadNamed.error, run: row.loadNamed.run, deskTop: row.loadNamed.deskTop, de: row.loadNamed.driveError?.text }
          : undefined,
        inCore: row.diag?.errorInfo
          ? { t18: row.diag.errorInfo.track18, flagged: row.diag.errorInfo.flaggedCount }
          : undefined,
        dos: row.diag?.dos1541
          ? {
              err: row.diag.dos1541.errorChannel,
              id: row.diag.dos1541.diskIdHex,
              bamId: row.diag.imgBamIdHex,
              hdr: row.diag.dos1541.lastHeaderHex,
              jobs: row.diag.dos1541.jobsHex,
            }
          : row.diag?.dos1541,
        exception: row.exception,
      }),
    );
  }
} finally {
  writeFileSync(join(outDir, `matrix-${tag}.json`), JSON.stringify({ jiffy, keyMs, freshBoot, results }, null, 2));
  await browser.close();
}
const fails = results.filter((r) => !r.listed || r.loadNamed?.error);
console.log(JSON.stringify({ tag, total: results.length, failed: fails.length }));
process.exit(fails.length ? 1 : 0);
