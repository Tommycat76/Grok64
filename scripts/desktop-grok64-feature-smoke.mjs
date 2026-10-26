#!/usr/bin/env node
/**
 * By-hand smoke matrix: every Grok64-only surface (screenshots + JSON).
 * Run after flush / safe-profile changes — no merge gate, Tom baseline artifact.
 *
 *   npm run test:desktop-grok64-feature-smoke
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  assertGrok64WasmCore,
  clearEmulatorJsCache,
  grok64CoreBuildIdFromManifest,
  grok64DatapathFromEnv,
  installGrok64CoreNetworkGuard,
} from "./desktop-grok64-core.mjs";
import { CART_COMPAT_CATALOG, cartFixturePath } from "./cart-compat-catalog.mjs";
import { synthJiffyPair } from "./drive-combo-qa-lib.mjs";
import { geosBaselineD64 } from "./geos-fixture-lib.mjs";
import {
  canvasLooksLikeCartMenu,
  grok64FloppyAutostartPoison,
  isBasicReadyScreen,
  patchLocalStorage,
  powerOnDesktop,
  typeBasic,
  waitForG64,
  waitRunning,
} from "./desktop-qa-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const shotDir = join(process.cwd(), "screenshots", "grok64-feature-smoke");
const outDir = join(process.cwd(), "artifacts", "grok64-feature-smoke");
mkdirSync(shotDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

const report = {
  capturedAt: new Date().toISOString(),
  coreBuildId: grok64CoreBuildIdFromManifest(),
  features: [],
};

function row(id, name, pass, extra = {}) {
  const entry = { id, name, pass, screenshot: extra.screenshot ?? null, ...extra };
  report.features.push(entry);
  return entry;
}

async function shot(page, file, label) {
  const path = join(shotDir, file);
  await page.screenshot({ path, fullPage: true });
  return path;
}

if (!grok64DatapathFromEnv()) {
  report.skipped = true;
  writeFileSync(join(outDir, "smoke.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: false, skipped: true }));
  process.exit(0);
}

async function ensureDirtyProfile(page, combo) {
  const seeded = await patchLocalStorage(page, combo);
  if (!seeded) {
    await page.evaluate((c) => {
      const data = {
        state: {
          powered: false,
          running: false,
          booting: false,
          jiffyDos: !!c.jiffy,
          reuSize: c.reu ?? "2048kB",
          videoStandard: c.video ?? "pal",
          iecMap:
            c.drive === "cmd-layout"
              ? { 8: "1541", 9: "cmdhd", 10: "none", 11: "none" }
              : { 8: "1541", 9: "none", 10: "none", 11: "none" },
          iecDrive: c.drive === "cmd-layout" ? "cmdhd" : "1541",
          iecUnit: c.drive === "cmd-layout" ? 9 : 8,
        },
        version: 0,
      };
      localStorage.setItem("grok64-emu", JSON.stringify(data));
    }, combo);
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForG64(page);
}

const d64Path = geosBaselineD64().path;
const d64Name = basename(d64Path);
const ss5Entry = CART_COMPAT_CATALOG.find((c) => c.id === "ss5");
const ss5Path = ss5Entry ? cartFixturePath(ss5Entry) : null;
const ss5Name = "Super_Snapshot_v5.00_1990_NTSC.crt";

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await installGrok64CoreNetworkGuard(page, base);

let allPass = true;
try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await clearEmulatorJsCache(page);
  await ensureDirtyProfile(page, { video: "pal", jiffy: false, reu: "2048kB", drive: "cmd-layout" });
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
  const core = await assertGrok64WasmCore(page, { timeoutMs: 120_000 });
  row("wasm-core", "Grok64 WASM VICE core + datapath", Boolean(core?.attach), {
    screenshot: await shot(page, "01-wasm-core.png", "core"),
    detail: core,
  });

  const palNtsc = await page.evaluate(() => {
    let stored = "";
    try {
      const raw = localStorage.getItem("grok64-emu");
      if (raw) stored = JSON.parse(raw).state?.videoStandard ?? "";
    } catch {
      /* ignore */
    }
    return {
      stored,
      opts: window.__g64?.opts?.()?.vice_video_standard,
      reu: window.__g64?.sessionFlags?.()?.reuSize,
    };
  });
  const palOk = /pal/i.test(String(palNtsc.stored || palNtsc.opts || ""));
  row("pal-ntsc", "PAL/NTSC video standard (Settings persist)", palOk, {
    screenshot: await shot(page, "02-pal-ntsc.png", "pal"),
    detail: palNtsc,
  });

  const reuStored = await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("grok64-emu") || "{}").state?.reuSize ?? "";
    } catch {
      return "";
    }
  });
  const reuOk = /2048|2\s*m/i.test(String(reuStored || palNtsc.reu || ""));
  row("reu", "REU expansion (real VICE REU)", reuOk, {
    screenshot: await shot(page, "03-reu.png", "reu"),
    detail: { reuSize: palNtsc.reu, opts: palNtsc.opts },
  });

  if (existsSync(d64Path)) {
    const d64B64 = readFileSync(d64Path).toString("base64");
    await page.evaluate(async ({ name, b64 }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await window.__g64?.importLibraryBytes?.(name, bin);
    }, { name: d64Name, b64: d64B64 });
    await page.locator('button[aria-label="Software"]').click({ timeout: 15_000 });
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: /On this device/i }).click();
    await page.waitForTimeout(300);
    await page.locator('input[type="file"]').setInputFiles(d64Path);
    await page.waitForTimeout(1200);
    await page.keyboard.press("Escape").catch(() => {});
    await page.locator('button[aria-label="Software"]').click({ timeout: 15_000 });
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: /On this device/i }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: `Insert ${d64Name}` }).first().click({ timeout: 60_000 });
    await waitRunning(page, 180_000);
    await page.waitForTimeout(3500);
    const diag = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
    const live8 = await page.evaluate(() => window.__g64?.viceDriveLive?.(8));
    const iecMap = await page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem("grok64-emu") || "{}").state?.iecMap;
      } catch {
        return null;
      }
    });
    const reattachOk = (diag?.viceLastReattach?.rc ?? -1) === 0;
    const tdeOk = (live8?.wasmTdeImageBytes ?? 0) > 174_000 && live8?.wasmGcrLoaded === 1;
    const serialOk = diag?.viceDriveBus?.serialDeviceLabel !== "virt";
    const flushOk = (reattachOk || tdeOk) && serialOk && iecMap?.[9] === "cmdhd";
    row("library-insert-flush", "Library Insert + BMC64 flush (unit 8 floppy)", flushOk, {
      screenshot: await shot(page, "04-library-insert-flush.png", "insert"),
      live8,
      iecMap,
      viceLastReattach: diag?.viceLastReattach,
    });
  } else {
    row("library-insert-flush", "Library Insert + BMC64 flush", false, { skipped: "no GEOS fixture" });
  }

  await patchLocalStorage(page, { video: "pal", jiffy: true, reu: "2048kB", drive: "cmd-layout" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitRunning(page, 120_000);
  await page.evaluate(async (roms) => {
    for (const [name, bytes] of Object.entries(roms)) {
      const id = /1541/i.test(name) ? "jiffy-1541" : "jiffy-c64";
      await window.__g64?.putRomBytes?.(id, name, bytes);
    }
    window.__g64?.setJiffyDos?.(true);
  }, synthJiffyPair());
  for (let i = 0; i < 50; i++) {
    const live = await page.evaluate(() => window.__g64?.jiffyLive?.());
    if (live) break;
    await page.waitForTimeout(500);
  }
  const jiffy = await page.evaluate(async () => {
    const d = await window.__g64?.attachDiskDiag?.({ light: true });
    return { live: window.__g64?.jiffyLive?.(), want: d?.jiffyWant, diagLive: d?.jiffyLive };
  });
  row("jiffy", "JiffyDOS ROM pair + live KERNAL/drive swap", Boolean(jiffy.live || jiffy.diagLive || jiffy.want), {
    screenshot: await shot(page, "05-jiffy.png", "jiffy"),
    detail: jiffy,
  });

  await page.evaluate(() => {
    window.__g64?.setWarp?.(true);
  });
  await page.waitForTimeout(400);
  const warpOn = await page.evaluate(() => window.__g64?.sessionFlags?.()?.warped);
  await page.evaluate(() => window.__g64?.setWarp?.(false));
  row("warp", "Warp CPU toggle", warpOn === true, {
    screenshot: await shot(page, "06-warp.png", "warp"),
  });

  await page.evaluate(async () => {
    window.__g64?.setIecSlot?.(8, "sd2iec");
    window.__g64?.resetDos?.();
    await window.__g64?.seedSd?.([
      { name: "SMOKE.PRG", path: "", data: new Uint8Array([1, 8, 0, 10, 0xcc]).buffer },
      { name: "DEEP.PRG", path: "folder", data: new Uint8Array([1, 8, 0, 10, 0xdd]).buffer },
    ]);
  });
  await page.waitForTimeout(1200);
  await typeBasic(page, 'LOAD"$",8', { afterMs: 42_000 });
  let sdList = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  for (let i = 0; i < 30 && /LOADING/i.test(sdList); i++) {
    await page.waitForTimeout(1500);
    sdList = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  }
  const cd = await page.evaluate(async () => window.__g64?.runDos?.('CD:"folder"'));
  const loadDollar = await page.evaluate(() => {
    const iec = window.__g64?.debugWasmIec?.(8, 0);
    const head = iec?.head ?? [];
    const wasmDir =
      (iec?.dataLen ?? 0) > 32 && head.includes(71) && head.includes(82) && head.includes(79);
    return { wasmDir, dataLen: iec?.dataLen ?? 0 };
  });
  const sdOk = (loadDollar.wasmDir || /SMOKE/i.test(sdList)) && /OK/i.test(cd || "");
  row("sd2iec", "SD2IEC mount + LOAD$ + CD (flush must not break)", sdOk, {
    screenshot: await shot(page, "07-sd2iec.png", "sd2iec"),
    listHead: sdList.slice(0, 160),
    cd,
  });

  const cmdProbe = await page.evaluate(() => {
    let iecMap = null;
    try {
      iecMap = JSON.parse(localStorage.getItem("grok64-emu") || "{}").state?.iecMap;
    } catch {
      /* ignore */
    }
    return { iecMap, live9: window.__g64?.viceDriveLive?.(9) };
  });
  const cmdOk = cmdProbe.iecMap?.[9] === "cmdhd";
  row("cmd-hd", "CMD HD on unit 9 (Settings IEC map survives flush path)", cmdOk, {
    screenshot: await shot(page, "08-cmd-hd.png", "cmd"),
    detail: cmdProbe,
  });

  if (ss5Path && existsSync(ss5Path)) {
    await page.locator('button[aria-label="Power off"]').first().click({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await powerOnDesktop(page, base, { navigate: false });
    await waitRunning(page, 120_000);
    await page.waitForTimeout(3000);
    const bytes = [...readFileSync(ss5Path)];
    await page.evaluate(async ({ name, bytes }) => window.__g64?.importLibraryBytes?.(name, bytes), {
      name: ss5Name,
      bytes,
    });
    await page.locator('button[aria-label="Software"]').click({ timeout: 15_000 });
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: /On this device/i }).click();
    await page.waitForTimeout(400);
    const card = page.locator(".g64-card").filter({ hasText: /Super_Snapshot/i });
    await card.locator('button[aria-label^="Play"]').click({ timeout: 60_000 });
    await waitRunning(page, 180_000);
    await page.waitForTimeout(8000);
    const cartText = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
    const pix = await canvasLooksLikeCartMenu(page, { minBuckets: 3 });
    const cartOk =
      /SUPER SNAPSHOT|SNAPSHOT BY/i.test(cartText) &&
      !grok64FloppyAutostartPoison(cartText) &&
      pix.pass;
    row("cart-ss5-play", "Cartridge library Play (Super Snapshot 5)", cartOk, {
      screenshot: await shot(page, "09-cart-ss5-play.png", "ss5"),
    });

    await page.locator('button[aria-label="Reset"]').click({ timeout: 15_000 });
    await waitRunning(page, 90_000);
    await page.waitForTimeout(8000);
    await page.evaluate(() => window.__g64?.hwPress?.("cart-out", "short"));
    await waitRunning(page, 120_000);
    let cartOutOk = false;
    let afterOut = { text: "", flags: {} };
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(1000);
      afterOut = await page.evaluate(() => ({
        text: window.__g64?.screenText?.() ?? "",
        flags: window.__g64?.sessionFlags?.(),
        cartLive: window.__g64?.cartLive?.(),
        title: window.__g64?.title?.() ?? "",
      }));
      const cartGone = !afterOut.flags?.cart && afterOut.cartLive === false;
      const basicOk =
        isBasicReadyScreen(afterOut.text) ||
        (/READY/i.test(afterOut.text) && afterOut.title === "BASIC");
      if (cartGone && (basicOk || !/SUPER SNAPSHOT|SNAPSHOT BY/i.test(afterOut.text))) {
        cartOutOk = cartGone;
        break;
      }
    }
    row("cart-out-power-cycle", "CART OUT (full power-cycle class reset to BASIC)", cartOutOk, {
      screenshot: await shot(page, "10-cart-out-basic.png", "cart-out"),
      detail: { cart: afterOut.flags?.cart, head: afterOut.text.slice(0, 120) },
    });
  } else {
    row("cart-ss5-play", "Cartridge Play", false, { skipped: "no SS5 fixture" });
    row("cart-out-power-cycle", "CART OUT", false, { skipped: "no SS5 fixture" });
  }

  const nuvieApi = await page.evaluate(() => typeof window.__g64?.playNuvie === "function");
  row("nuvie-api", "NUVIE / REU player hook (playNuvie)", nuvieApi, {
    screenshot: await shot(page, "11-nuvie-hook.png", "nuvie"),
  });

  await page.locator('button[aria-label="Power off"]').first().click({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.locator('button[aria-label="Power on"], .g64-power').first().click({ timeout: 10_000 });
  await waitRunning(page, 120_000);
  const powered = await page.evaluate(() => window.__g64?.powered?.() && window.__g64?.running?.());
  row("power-cycle", "UI power off / on (session chrome)", powered, {
    screenshot: await shot(page, "12-power-cycle.png", "power"),
  });

  allPass = report.features.every((f) => f.skipped || f.pass === true);
  report.pass = allPass;
  writeFileSync(join(outDir, "smoke.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: allPass, features: report.features.map((f) => ({ id: f.id, pass: f.pass })) }));
  process.exit(allPass ? 0 : 1);
} catch (e) {
  report.error = String(e?.message || e);
  writeFileSync(join(outDir, "smoke.json"), JSON.stringify(report, null, 2));
  console.error(e);
  process.exit(1);
} finally {
  await browser.close();
}
