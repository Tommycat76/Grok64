#!/usr/bin/env node
/**
 * a1bacdc hands-on QA (desktop UI + typed commands) — pass/fail table.
 *   node scripts/fetch-fixtures.mjs
 *   npm run test:desktop-a1bacdc
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import {
  catalogSearch,
  ensureReal1541Timing,
  openSoftware,
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
const FIX = join(process.cwd(), "fixtures");
const outDir = join(process.cwd(), "artifacts", "desktop-a1bacdc-qa");
mkdirSync(outDir, { recursive: true });

const ONLY = process.env.A1BACDC_ONLY?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
const want = (id) => !ONLY || ONLY.some((p) => id.includes(p));

const rows = [];
const push = (row) => {
  rows.push(row);
  const tag = row.skipped ? "SKIP" : row.pass ? "PASS" : "FAIL";
  console.log(tag, row.id, row.detail ?? row.reason ?? "");
};

async function boot(page, combo = {}) {
  await patchLocalStorage(page, {
    video: "ntsc",
    sid: "8580",
    reu: combo.reu ?? "none",
    drive: combo.drive ?? "1541",
    mouse: combo.mouse ?? false,
    jiffy: !!combo.jiffy,
    joy: 2,
    ...combo,
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120000);
  return assertGrok64WasmCore(page, { timeoutMs: 120000 });
}

async function playCart(page, file) {
  const bytes = [...readFileSync(file)];
  const name = file.split("/").pop();
  await page.evaluate(
    async ({ name, bytes }) => {
      await window.__g64?.playBytes?.(name, bytes, { autostart: true });
    },
    { name, bytes },
  );
  await waitRunning(page, 120000);
  await page.waitForTimeout(4000);
}

async function pressCartFreezeUi(page) {
  await page.waitForFunction(() => window.__g64?.sessionFlags?.().cart === true, { timeout: 25_000 });
  const btn = page.locator('button[data-hw="cart-fz"]');
  await btn.waitFor({ state: "visible", timeout: 12_000 });
  await btn.click({ timeout: 8000 });
  return "ui";
}

async function tapHostFnKey(page, code) {
  await page.locator("#grok64-player").click({ timeout: 8000 });
  await page.waitForTimeout(120);
  await page.keyboard.press(code);
  await page.waitForTimeout(450);
}

function synthJiffyPair() {
  const c64 = new Uint8Array(8192).fill(0x4a);
  const d41 = new Uint8Array(8192).fill(0x41);
  c64[0] = 0x4a;
  d41[0] = 0x41;
  return {
    "JiffyDOS_C64_6.01.bin": [...c64],
    "JiffyDOS_1541-II_6.00.bin": [...d41],
  };
}

let browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--js-flags=--max-old-space-size=4096"],
});
let page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

try {
  if (!grok64DatapathFromEnv()) {
    push({ id: "env", pass: false, reason: "VITE_GROK64_VICE_DATAPATH missing" });
    throw new Error("no datapath");
  }
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await clearEmulatorJsCache(page);

  async function freshPage() {
    try {
      await page.close();
    } catch {
      /* crashed */
    }
    try {
      page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    } catch {
      await browser.close().catch(() => null);
      browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      });
      page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    }
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await clearEmulatorJsCache(page);
  }

  // Freeze menus + AR6 F1/F7 (same session as AR6 freeze)
  if (!want("freeze") && !want("ar6")) {
    push({ id: "freeze-skip", pass: true, skipped: true, reason: "A1BACDC_ONLY" });
  }
  for (const [id, crt] of [
    ["freeze-ar6-ui", "ar6.crt"],
    ["freeze-fc3-ui", "fc3.crt"],
    ["freeze-ss5-ui", "ss5.crt"],
  ]) {
    if (!want("freeze") && !want("ar6") && !want("matrix")) continue;
    if (!want("freeze") && id !== "freeze-ar6-ui" && !want("matrix")) continue;
    const p = join(FIX, "carts", crt);
    if (!existsSync(p)) {
      push({ id, skipped: true, pass: false, reason: "missing cart" });
      continue;
    }
    await freshPage();
    await boot(page);
    await playCart(page, p);
    const via = await pressCartFreezeUi(page);
    await page.waitForTimeout(2500);
    const text = await page.evaluate(() => window.__g64?.screenText?.() || "");
    const shot = await page.evaluate(async () => (await window.__g64?.shot?.())?.b64?.length ?? 0);
    push({
      id,
      pass: shot > 800 && !/^READY\.?$/m.test(text.trim()),
      detail: { via, head: text.slice(0, 70) },
    });
    if (id === "freeze-ar6-ui") {
      try {
        await page.waitForTimeout(1500);
        const before = await page.evaluate(() => window.__g64?.screenText?.() || "");
        await tapHostFnKey(page, "F1");
        await tapHostFnKey(page, "F7");
        const after = await page.evaluate(() => window.__g64?.screenText?.() || "");
        push({
          id: "ar6-f1-f7",
          pass:
            after.length > 20 &&
            (after !== before || /AR|REPLAY|FREEZE|MENU|MONITOR|DISK/i.test(after)),
          detail: { before: before.slice(0, 50), after: after.slice(0, 50) },
        });
      } catch (e) {
        push({
          id: "ar6-f1-f7",
          pass: false,
          reason: `F-keys during AR freeze: ${String(e).slice(0, 100)}`,
        });
        await freshPage();
      }
    }
  }

  // SS5 + boulder fast load (stock kernal — jiffy off)
  const disk = join(FIX, "disks", "boulder-dash.d64");
  const ss5 = join(FIX, "carts", "ss5.crt");
  if ((want("ss5") || want("boulder") || !ONLY) && existsSync(disk) && existsSync(ss5)) {
    await freshPage();
    await boot(page, { jiffy: false });
    await playCart(page, ss5);
    const jiffyLive = await page.evaluate(() => window.__g64?.jiffyLive?.());
    await ensureReal1541Timing(page);
    const wall0 = Date.now();
    const ti0 = await page.evaluate(async () => window.__g64?.printTi?.());
    const bytes = [...readFileSync(disk)];
    await page.evaluate(
      async ({ bytes }) => {
        await window.__g64?.playBytes?.("boulder-dash.d64", bytes, { autostart: true, title: "Boulder Dash" });
      },
      { bytes },
    );
    await waitRunning(page, 120000);
    await page.waitForTimeout(45_000);
    const ti1 = await page.evaluate(async () => window.__g64?.printTi?.());
    const text = await page.evaluate(() => window.__g64?.screenText?.() || "");
    const wall =
      ti0 != null && ti1 != null ? ti1 - ti0 : Date.now() - wall0;
    const playing = /boulder|level|score|press|start|lives/i.test(text) || text.length > 120;
    push({
      id: "ss5-boulder-load",
      pass: !jiffyLive && wall < 120_000 && playing && !/^READY\.?$/m.test(text.trim()),
      detail: { jiffyLive, tiDelta: wall, head: text.slice(0, 60) },
    });
  } else if (want("ss5") || want("boulder") || !ONLY) {
    push({ id: "ss5-boulder-load", skipped: true, pass: false, reason: "fixtures" });
  }

  // NUVIE Bad Tom + 16MB REU
  const prg = join(FIX, "nuvie", "nuvieplayer1.0.prg");
  const reu = join(FIX, "nuvie", "badtom.reu");
  if (want("nuvie") && existsSync(prg) && existsSync(reu)) {
    await freshPage();
    await boot(page, { reu: "16384kB" });
    await page.evaluate(
      async ({ prg, reu }) => {
        await window.__g64?.playNuvie?.(new Uint8Array(prg), new Uint8Array(reu), "badtom");
      },
      { prg: [...readFileSync(prg)], reu: [...readFileSync(reu)] },
    );
    await waitRunning(page, 120000);
    await page.waitForTimeout(20_000);
    const text = await page.evaluate(() => window.__g64?.screenText?.() || "");
    const samples = new Set();
    for (let i = 0; i < 6; i++) {
      samples.add(await page.evaluate(async () => (await window.__g64?.shot?.())?.b64?.slice(0, 800) ?? ""));
      await page.waitForTimeout(3500);
    }
    const reuSize = await page.evaluate(() => window.__g64?.settings?.().reuSize);
    push({
      id: "nuvie-badtom-reu",
      pass:
        reuSize === "16384kB" &&
        !/NO VALID NUVIE/i.test(text) &&
        (samples.size > 1 || /nuvie|badtom|player|music/i.test(text)),
      detail: { frames: samples.size, reuSize, head: text.slice(0, 60) },
    });
  } else if (want("nuvie") || !ONLY) {
    push({ id: "nuvie-badtom-reu", skipped: true, pass: false, reason: "nuvie fixtures" });
  }

  // GEOS upload → media list → desktop + mouse
  const geosDir = join(FIX, "geos");
  const geosImg = existsSync(geosDir) ? readdirSync(geosDir).find((f) => /\.d64$/i.test(f)) : null;
  if (want("geos") && geosImg) {
    await freshPage();
    await boot(page, { mouse: true, reu: "none" });
    const geosBytes = [...readFileSync(join(geosDir, geosImg))];
    await page.evaluate(
      async ({ name, bytes }) => {
        await window.__g64?.setSettingsOpen?.(false);
        return window.__g64?.bootGeos?.(name, bytes);
      },
      { name: geosImg, bytes: geosBytes },
    );
    await page.waitForTimeout(95_000);
    const media = await page.evaluate(() => window.__g64?.media?.() ?? []);
    const text = await page.evaluate(() => window.__g64?.screenText?.() || "");
    const mouseOn = await page.evaluate(() => window.__g64?.sessionFlags?.().mouseMode);
    push({
      id: "geos-upload-boot",
      pass:
        media.some((m) => m.size > 170000 && /geos|d64/i.test(m.name)) &&
        /GEOS|DESK|DISK|DIRECTORY|INFO/i.test(text) &&
        mouseOn,
      detail: { media, mouseOn, head: text.slice(0, 80) },
    });
  } else if (want("geos") || !ONLY) {
    push({
      id: "geos-upload-boot",
      skipped: true,
      pass: false,
      reason: geosImg ? "section filter" : "no GEOS d64 — run fetch-fixtures",
    });
  }

  const jiffyPair = synthJiffyPair();
  // Jiffy versioned ROM filenames
  if (want("jiffy") || want("timing")) {
  await freshPage();
  await boot(page, { jiffy: true });
  const pair = jiffyPair;
  await page.evaluate(async (roms) => {
    for (const [name, bytes] of Object.entries(roms)) {
      const id = /1541/i.test(name) ? "jiffy-1541" : "jiffy-c64";
      await window.__g64?.putRomBytes?.(id, name, bytes);
    }
    window.__g64?.setJiffyDos?.(true);
  }, pair);
  await page.waitForTimeout(2000);
  await page.reload();
  await boot(page, { jiffy: true });
  const jiffyLive = await page.evaluate(() => window.__g64?.jiffyLive?.());
  const banner = await page.evaluate(() => window.__g64?.screenText?.() || "");
  push({
    id: "jiffy-versioned-roms",
    pass: jiffyLive === true,
    detail: { jiffyLive, bannerHead: banner.slice(0, 60) },
  });

  }
  async function boulderLoadTiming(page, diskPath) {
    const name = diskPath.split("/").pop() ?? "boulder-dash.d64";
    const bytes = [...readFileSync(diskPath)];
    await ensureReal1541Timing(page);
    const wall0 = Date.now();
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
    const tiDelta = tiBefore != null && tiAfter != null ? tiAfter - tiBefore : null;
    return { tiBefore, tiAfter, tiDelta, wallMs: Date.now() - wall0 };
  }

  // PRINT TI timing (stock vs jiffy) — jiffies when PRINT TI works, else wall ms (matrix parity)
  if (want("timing") && existsSync(disk)) {
    await freshPage();
    await boot(page, { jiffy: false });
    await page.waitForTimeout(2500);
    const stock = await boulderLoadTiming(page, disk);
    await patchLocalStorage(page, { jiffy: true });
    await page.reload();
    await boot(page, { jiffy: true });
    await page.evaluate(async (roms) => {
      for (const [name, bytes] of Object.entries(roms)) {
        const id = /1541/i.test(name) ? "jiffy-1541" : "jiffy-c64";
        await window.__g64?.putRomBytes?.(id, name, bytes);
      }
      window.__g64?.setJiffyDos?.(true);
    }, jiffyPair);
    await page.waitForTimeout(1500);
    const jiffy = await boulderLoadTiming(page, disk);
    const stockMs = stock.tiDelta ?? stock.wallMs;
    const jiffyMs = jiffy.tiDelta ?? jiffy.wallMs;
    const jiffyLive = await page.evaluate(() => window.__g64?.jiffyLive?.());
    const tiOk =
      stock.tiDelta != null && jiffy.tiDelta != null ? jiffy.tiDelta < stock.tiDelta : jiffyMs <= stockMs + 20_000;
    push({
      id: "print-ti-timing",
      pass: jiffyLive === true && stockMs >= 60_000 && tiOk,
      detail: {
        stock,
        jiffy,
        jiffyLive,
        stockMs,
        jiffyMs,
        note: stock.tiDelta == null ? "PRINT TI jiffies not scraped; wall-ms + jiffyLive" : "TI jiffies",
      },
    });
  }

  // Catalog auto-RUN / Commando space (HVSC sid → cracktro nudge)
  if (want("catalog")) {
  await freshPage();
  await powerOnDesktop(page, base);
  await openSoftware(page);
  for (const q of ["Paradroid", "Turrican"]) {
    await catalogSearch(page, q);
    const hits = await page.locator(".g64-hit").count();
    if (!hits) {
      push({ id: `catalog-${q.toLowerCase()}`, skipped: true, pass: false, reason: "no catalog hit" });
      continue;
    }
    await page.locator(".g64-hit").first().locator('button[aria-label^="Play"]').click();
    await waitRunning(page, 180_000);
    await page.waitForTimeout(12_000);
    const text = await page.evaluate(() => window.__g64?.screenText?.() || "");
    push({
      id: `catalog-${q.toLowerCase()}`,
      pass: !/^READY\.?$/m.test(text.trim()) && text.length > 30,
      detail: text.slice(0, 70),
      optional: true,
    });
    await openSoftware(page);
  }
  await catalogSearch(page, "Commando");
  if ((await page.locator(".g64-hit").count()) > 0) {
    await page.locator(".g64-hit").first().locator('button[aria-label^="Play"]').click();
    await waitRunning(page, 60_000);
    await page.waitForTimeout(6000);
    const text = await page.evaluate(() => window.__g64?.screenText?.() || "");
    push({
      id: "catalog-commando-space",
      pass: text.length > 20,
      detail: text.slice(0, 70),
      optional: true,
    });
  } else {
    push({ id: "catalog-commando-space", skipped: true, pass: false, reason: "no hit", optional: true });
  }

  }
  // Cart matrix: Super Snapshot 4 & 5 (stock kernal)
  if (want("matrix") || want("ss4") || want("ss5")) for (const [label, file] of [
    ["ss4-freeze", "ss4.crt"],
    ["ss5-freeze", "ss5.crt"],
  ]) {
    const p = join(FIX, "carts", file);
    if (!existsSync(p)) {
      push({ id: label, skipped: true, pass: false, reason: "missing crt" });
      continue;
    }
    await freshPage();
    await boot(page, { jiffy: false });
    await playCart(page, p);
    await pressCartFreezeUi(page);
    await page.waitForTimeout(2500);
    const text = await page.evaluate(() => window.__g64?.screenText?.() || "");
    push({
      id: label,
      pass: !/^READY\.?$/m.test(text.trim()) && /SNAPSHOT|TURBO|FREEZE|MENU|V\d/i.test(text),
      detail: text.slice(0, 70),
    });
  }
} catch (e) {
  push({ id: "suite-error", pass: false, detail: String(e) });
  try {
    await page?.screenshot?.({ path: join(outDir, "crash.png") }).catch(() => null);
  } catch {
    /* ignore */
  }
}

await browser.close();
writeFileSync(join(outDir, "results.json"), JSON.stringify({ rows }, null, 2));
console.log("\n--- pass/fail table ---");
for (const r of rows) {
  const st = r.skipped ? "SKIP" : r.pass ? "PASS" : "FAIL";
  console.log(`| ${r.id} | ${st} | ${JSON.stringify(r.detail ?? r.reason ?? "").slice(0, 80)} |`);
}
const failed = rows.filter((r) => !r.pass && !r.skipped && !r.optional);
process.exit(failed.length ? 1 : 0);
