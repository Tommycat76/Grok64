#!/usr/bin/env node
/**
 * Custom-core verification matrix (attach+c64read required).
 *   node scripts/fetch-fixtures.mjs
 *   npm run test:desktop-custom-matrix
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import {
  ensureReal1541Timing,
  patchLocalStorage,
  powerOnDesktop,
  typeBasic,
  waitRunning,
} from "./desktop-qa-lib.mjs";
import {
  assertGrok64WasmCore,
  clearEmulatorJsCache,
  grok64DatapathFromEnv,
  readGrok64CoreStatus,
} from "./desktop-grok64-core.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const outDir = join(process.cwd(), "artifacts", "desktop-custom-core-matrix");
mkdirSync(outDir, { recursive: true });

const FIX = join(process.cwd(), "fixtures");
const rows = [];
const push = (row) => {
  rows.push(row);
  console.log(row.pass ? "PASS" : row.skipped ? "SKIP" : "FAIL", row.id, row.core ? `core attach=${row.core.attach} c64read=${row.core.c64read}` : "", row.detail ?? row.reason ?? "");
};

async function coreOf(page) {
  return readGrok64CoreStatus(page);
}

async function boot(page, combo = {}) {
  await patchLocalStorage(page, {
    video: "ntsc",
    sid: "8580",
    reu: combo.reu ?? "none",
    drive: combo.drive ?? "1541",
    mouse: combo.mouse ?? false,
    joy: 2,
    ...combo,
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120000);
  const core = await assertGrok64WasmCore(page, { timeoutMs: 120000 });
  return core;
}

async function playBytes(page, name, path, { autostart = true } = {}) {
  const bytes = [...readFileSync(path)];
  await page.evaluate(
    async ({ name, bytes, autostart }) => {
      await window.__g64?.playBytes?.(name, bytes, { autostart });
    },
    { name, bytes, autostart },
  );
  await waitRunning(page, 120000);
}

async function loadStarReal1541(page, diskPath) {
  const name = diskPath.split("/").pop() ?? "game.d64";
  const bytes = [...readFileSync(diskPath)];
  await ensureReal1541Timing(page);
  const tiBefore = await page.evaluate(async () => window.__g64?.printTi?.());
  await page.evaluate(
    async ({ name, bytes }) => {
      await window.__g64?.playBytes?.(name, bytes, { autostart: false });
    },
    { name, bytes },
  );
  await waitRunning(page, 90_000);
  await typeBasic(page, 'LOAD"*",8,1', { afterMs: 120_000, listAfterDollar: false });
  await page.waitForTimeout(3000);
  const tiAfter = await page.evaluate(async () => window.__g64?.printTi?.());
  const delta = tiBefore != null && tiAfter != null ? tiAfter - tiBefore : null;
  return { tiBefore, tiAfter, tiDelta: delta, wallMs: null };
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

try {
  if (!grok64DatapathFromEnv()) {
    push({ id: "env", pass: false, reason: "VITE_GROK64_VICE_DATAPATH missing" });
    throw new Error("no datapath");
  }
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await clearEmulatorJsCache(page);

  // (1) SD2IEC LOAD"$",8 live
  let core = await boot(page, { drive: "1541" });
  await page.evaluate(async () => {
    window.__g64?.setIecSlot?.(8, "sd2iec");
    window.__g64?.resetDos?.();
    await window.__g64?.seedSd?.([
      { name: "ROOT.PRG", path: "", data: new Uint8Array([1, 8, 0, 10, 0xaa]).buffer },
      { name: "GAMES.PRG", path: "games", data: new Uint8Array([1, 8, 0, 10, 0xbb]).buffer },
    ]);
  });
  await page.waitForTimeout(1500);
  await typeBasic(page, 'LOAD"$",8', { afterMs: 22_000 });
  let text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  const loadDollar = await page.evaluate(() => {
    const mod = window.__ejs?.Module;
    const viaExport = typeof mod?._grok64_c64_read === "function" ? mod._grok64_c64_read(0x0400) : -1;
    const iec = window.__g64?.debugWasmIec?.(8, 0);
    const head = iec?.head ?? [];
    const wasmDir =
      (iec?.dataLen ?? 0) > 32 && head.includes(71) && head.includes(82) && head.includes(79);
    return { viaExport, wasmDir, dataLen: iec?.dataLen ?? 0 };
  });
  core = await coreOf(page);
  push({
    id: "sd2iec-load-dollar",
    pass:
      (loadDollar.wasmDir || /ROOT|GAMES|PRG|BLOCKS|GROK64/i.test(text)) && loadDollar.viaExport > 0,
    core,
    detail: { head: text.slice(0, 80), ...loadDollar },
  });

  // (2) Insert + media list + LOAD"*",8,1
  const disk = join(FIX, "disks", "boulder-dash.d64");
  if (existsSync(disk)) {
    await boot(page, { drive: "1541" });
    await page.evaluate(() => window.__g64?.resetReady?.());
    await waitRunning(page, 30000);
    const insertName = "boulder-dash.d64";
    const bytes = [...readFileSync(disk)];
    const inserted = await page.evaluate(
      async ({ bytes, name }) => {
        await window.__g64?.playBytes?.(name, bytes, { autostart: false });
        await new Promise((r) => setTimeout(r, 2000));
        const media = window.__g64?.media?.() ?? [];
        return { media, len: media.length, first: media[0] ?? null };
      },
      { name: insertName, bytes },
    );
    core = await coreOf(page);
    push({
      id: "insert-media-list",
      pass: inserted.len >= 1 && inserted.first?.size > 170000 && /boulder|dash|d64/i.test(inserted.first?.name ?? ""),
      core,
      detail: inserted,
    });
    await typeBasic(page, 'LOAD"*",8,1');
    await page.waitForTimeout(15000);
    text = await page.evaluate(() => window.__g64?.screenText?.() || "");
    core = await coreOf(page);
    push({
      id: "insert-load-star",
      pass: !/FILE NOT FOUND/i.test(text),
      core,
      detail: text.slice(0, 80),
    });
  } else {
    push({ id: "insert-load-star", pass: false, skipped: true, reason: "missing boulder-dash.d64" });
  }

  // (3) Cart persist + fast load (AR6 + boulder disk)
  const ar6 = join(FIX, "carts", "ar6.crt");
  if (existsSync(ar6) && existsSync(disk)) {
    await boot(page);
    const t0 = Date.now();
    await playBytes(page, "ar6.crt", ar6);
    await page.waitForTimeout(3000);
    const cartLive = await page.evaluate(() => window.__g64?.sessionFlags?.().cart);
    const bytes = [...readFileSync(disk)];
    await page.evaluate(
      async ({ bytes }) => {
        await window.__g64?.playBytes?.("boulder-dash.d64", bytes);
      },
      { bytes },
    );
    await waitRunning(page, 120000);
    const dt = Date.now() - t0;
    const stillCart = await page.evaluate(() => window.__g64?.sessionFlags?.().cart);
    core = await coreOf(page);
    push({
      id: "cart-persist-boulder",
      pass: cartLive && stillCart && dt < 120000,
      core,
      detail: { cartLive, stillCart, ms: dt },
    });
  } else {
    push({ id: "cart-persist-boulder", skipped: true, pass: false, reason: "fixtures" });
  }

  // (4) Freeze menus
  for (const [id, file] of [
    ["freeze-ar6", "ar6.crt"],
    ["freeze-fc3", "fc3.crt"],
    ["freeze-ss5", "ss5.crt"],
  ]) {
    const p = join(FIX, "carts", file);
    if (!existsSync(p)) {
      push({ id, skipped: true, pass: false, reason: "missing cart" });
      continue;
    }
    await boot(page);
    await playBytes(page, file, p);
    await page.waitForTimeout(4000);
    await page.evaluate(() => window.__g64?.cartFreeze?.());
    await page.waitForTimeout(2500);
    text = await page.evaluate(() => window.__g64?.screenText?.() || "");
    const shot = await page.evaluate(async () => (await window.__g64?.shot?.())?.b64?.length ?? 0);
    core = await coreOf(page);
    push({
      id,
      pass: shot > 800 && !/^READY\.?$/m.test(text.trim()),
      core,
      detail: text.slice(0, 60) || `canvasB64=${shot}`,
    });
  }

  // (5) GEOS desktop ± REU + mouse
  const geosDir = join(FIX, "geos");
  const geosImg = existsSync(geosDir) ? readdirSync(geosDir).find((f) => /\.d64$/i.test(f)) : null;
  for (const reu of ["none", "16384kB"]) {
    const id = reu === "none" ? "geos-desktop" : "geos-desktop-reu";
    if (!geosImg) {
      push({ id, skipped: true, pass: false, reason: "no GEOS d64" });
      continue;
    }
    await boot(page, { reu, mouse: true, drive: "1541" });
    const geosBytes = [...readFileSync(join(geosDir, geosImg))];
    await page.evaluate(
      async ({ name, bytes }) => {
        await window.__g64?.bootGeos?.(name, bytes);
      },
      { name: geosImg, bytes: geosBytes },
    );
    await page.waitForTimeout(90_000);
    text = await page.evaluate(() => window.__g64?.screenText?.() || "");
    const mouseOn = await page.evaluate(() => window.__g64?.sessionFlags?.().mouseMode);
    core = await coreOf(page);
    push({
      id,
      pass: /GEOS|DISK|DIRECTORY|INFO|DESK/i.test(text) && mouseOn,
      core,
      detail: { reu, mouseOn, head: text.slice(0, 100) },
    });
  }

  // (6) NUVIE Bad Tom
  const prg = join(FIX, "nuvie", "nuvieplayer1.0.prg");
  const reu = join(FIX, "nuvie", "badtom.reu");
  if (existsSync(prg) && existsSync(reu)) {
    await page.close();
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await clearEmulatorJsCache(page);
    await boot(page, { reu: "16384kB" });
    const played = await page.evaluate(
      async ({ prg, reu }) => {
        const p = new Uint8Array(prg);
        const r = new Uint8Array(reu);
        await window.__g64?.playNuvie?.(p, r, "badtom");
        return true;
      },
      { prg: [...readFileSync(prg)], reu: [...readFileSync(reu)] },
    );
    await waitRunning(page, 120000);
    await page.waitForTimeout(8000);
    text = await page.evaluate(() => window.__g64?.screenText?.() || "");
    core = await coreOf(page);
    const samples = new Set();
    for (let i = 0; i < 4; i++) {
      const sig = await page.evaluate(async () => (await window.__g64?.shot?.())?.b64?.slice(0, 400) ?? "");
      samples.add(sig);
      await page.waitForTimeout(2000);
    }
    push({
      id: "nuvie-badtom",
      pass: played && !/NO VALID NUVIE/i.test(text) && samples.size > 1,
      core,
      detail: { frames: samples.size, head: text.slice(0, 60) },
    });
  } else {
    push({ id: "nuvie-badtom", skipped: true, pass: false, reason: "nuvie fixtures" });
  }

  // (7) JiffyDOS — stock vs jiffy boot time (boulder dash, real 1541 TDE @ 1×)
  if (existsSync(disk)) {
    await page.close();
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await clearEmulatorJsCache(page);
    await boot(page, { jiffy: false, drive: "1541" });
    const tStock0 = Date.now();
    const stockTiming = await ensureReal1541Timing(page);
    const stockTi = await loadStarReal1541(page, disk);
    stockTi.wallMs = Date.now() - tStock0;
    const stockMs = stockTi.wallMs;
    await patchLocalStorage(page, { jiffy: true, drive: "1541" });
    await page.reload();
    await boot(page, { jiffy: true, drive: "1541" });
    const tJ0 = Date.now();
    const jiffyTiming = await ensureReal1541Timing(page);
    const jiffyTi = await loadStarReal1541(page, disk);
    jiffyTi.wallMs = Date.now() - tJ0;
    const jiffyMs = jiffyTi.wallMs;
    const jiffyLive = await page.evaluate(() => window.__g64?.jiffyLive?.());
    core = await coreOf(page);
    push({
      id: "jiffy-timing",
      pass: jiffyLive && jiffyMs <= stockMs && stockMs >= 35_000,
      core,
      detail: { stockMs, jiffyMs, jiffyLive, stockTiming, jiffyTiming, stockTi, jiffyTi },
      optional: true,
    });
  }
} catch (e) {
  push({ id: "suite-error", pass: false, error: String(e) });
}

await browser.close();
const failed = rows.filter((r) => !r.pass && !r.skipped && !r.optional);
writeFileSync(join(outDir, "results.json"), JSON.stringify({ rows, failed: failed.length }, null, 2));
process.exit(failed.length ? 1 : 0);
