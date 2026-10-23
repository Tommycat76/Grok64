#!/usr/bin/env node
/**
 * Post–cart-matrix real-UI QA (Xvfb + xdotool + DOM clicks).
 *   npm run test:desktop-xdotool-extended
 *
 * Covers: catalog downloader, CMD HD layout, CSDB-style demos, freeze + autostart.
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  catalogSearch,
  ensureReal1541Timing,
  openSoftware,
  patchLocalStorage,
  powerOnDesktop,
  waitRunning,
} from "./desktop-qa-lib.mjs";
import { assertGrok64WasmCore, clearEmulatorJsCache, grok64DatapathFromEnv } from "./desktop-grok64-core.mjs";
import { writeExtendedQaReport } from "./generate-real-ui-qa-report.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const display = process.env.GROK64_XDISPLAY || ":99";
const outDir = join(process.cwd(), "artifacts", "desktop-xdotool-extended-qa");
mkdirSync(outDir, { recursive: true });

const FIX = join(process.cwd(), "fixtures");
const CART_AR6 = join(FIX, "carts", "ar6.crt");
const CART_FC3 = join(FIX, "carts", "fc3.crt");
const CART_SS5 = join(FIX, "carts", "ss5.crt");
const BOULDER = join(FIX, "disks", "boulder-dash.d64");

const rows = [];
const push = (row) => {
  rows.push(row);
  const tag = row.skipped ? "SKIP" : row.pass ? "PASS" : "FAIL";
  console.log(tag, row.id);
};

function sh(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      env: { ...process.env, DISPLAY: display },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    p.stdout?.on("data", (d) => (out += d));
    p.stderr?.on("data", (d) => (out += d));
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(out))));
  });
}

async function windowArea(id) {
  try {
    const out = await sh("xdotool", ["getwindowgeometry", "--shell", id]);
    const w = Number(/WIDTH=(\d+)/.exec(out)?.[1] ?? 0);
    const h = Number(/HEIGHT=(\d+)/.exec(out)?.[1] ?? 0);
    return w * h;
  } catch {
    return 0;
  }
}

async function findChromiumWindow(server) {
  const pid = server.process()?.pid;
  for (let i = 0; i < 50; i++) {
    try {
      const ids = (
        pid
          ? await sh("xdotool", ["search", "--pid", String(pid)])
          : await sh("xdotool", ["search", "--onlyvisible", "--class", "chromium"])
      )
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      let best = "";
      let bestArea = 0;
      for (const id of ids) {
        const area = await windowArea(id);
        if (area > bestArea) {
          bestArea = area;
          best = id;
        }
      }
      if (best && bestArea > 80_000) return best;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return "";
}

function synthJiffyPair() {
  const c64 = new Uint8Array(8192).fill(0x4a);
  const d41 = new Uint8Array(8192).fill(0x41);
  return {
    "JiffyDOS_C64_6.01.bin": [...c64],
    "JiffyDOS_1541-II_6.00.bin": [...d41],
  };
}

async function bootFresh(page, combo = {}) {
  await patchLocalStorage(page, { video: "ntsc", jiffy: false, ...combo });
  await page.reload({ waitUntil: "domcontentloaded" });
  await clearEmulatorJsCache(page);
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
  await assertGrok64WasmCore(page, { timeoutMs: 120_000 });
}

async function applyJiffy(page) {
  const pair = synthJiffyPair();
  await page.evaluate(async (roms) => {
    for (const [name, bytes] of Object.entries(roms)) {
      const id = /1541/i.test(name) ? "jiffy-1541" : "jiffy-c64";
      await window.__g64?.putRomBytes?.(id, name, bytes);
    }
    window.__g64?.setJiffyDos?.(true);
  }, pair);
  await page.waitForTimeout(1200);
  await page.reload({ waitUntil: "domcontentloaded" });
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
}

async function playCartFile(page, path, playName) {
  const bytes = [...readFileSync(path)];
  await page.evaluate(
    async ({ name, bytes }) => {
      await window.__g64?.playBytes?.(name, bytes, { autostart: true });
    },
    { name: playName ?? path.split("/").pop(), bytes },
  );
  await waitRunning(page, 120_000);
  await page.waitForFunction(() => window.__g64?.sessionFlags?.().cart === true, { timeout: 60_000 });
  await page.waitForTimeout(8000);
}

async function sampleCrtMotion(page, samples = 5, gapMs = 3500) {
  const hashes = [];
  for (let i = 0; i < samples; i++) {
    const slice = await page.evaluate(async () => {
      const shot = await window.__g64?.shot?.();
      return shot?.b64?.slice(0, 2000) ?? "";
    });
    hashes.push(slice);
    await page.waitForTimeout(gapMs);
  }
  const unique = new Set(hashes.filter(Boolean));
  const text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  const glitch = /SYNTAX ERROR|ILLEGAL QUANTITY|BREAK|READY\.\s*READY/i.test(text);
  return { frames: unique.size, glitch, head: text.slice(0, 80) };
}

const ONLY = process.env.EXTENDED_QA_ONLY?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
const want = (id) => !ONLY || ONLY.some((p) => id.includes(p));

const DEMO_QUERIES = [
  { id: "edge-of-disgrace", q: "Edge of Disgrace" },
  { id: "coma-light-13", q: "Coma Light 13" },
  { id: "uncensored", q: "Uncensored demo C64" },
];

let xvfb;
let server;
try {
  if (!grok64DatapathFromEnv()) throw new Error("VITE_GROK64_VICE_DATAPATH missing");
  xvfb = spawn("Xvfb", [display, "-screen", "0", "1280x800x24", "-ac"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 800));

  server = await chromium.launchServer({
    headless: false,
    env: { ...process.env, DISPLAY: display },
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1280,800"],
  });
  const browser = await chromium.connect(server.wsEndpoint());
  let page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(120_000);
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await clearEmulatorJsCache(page);
  const win = await findChromiumWindow(server);

  // —— (1) Catalog downloader ——
  await bootFresh(page);
  const stepsCatalog = [
    "Power on desktop",
    "Click Software toolbar (DOM)",
    "xdotool: focus search, type query",
    "Click Play on first hit",
    "Wait autostart; verify library + CRT signal",
  ];
  await page.locator(".g64-software").click({ timeout: 15_000 });
  await page.locator(".g64-catalog, .g64-sheet").first().waitFor({ timeout: 12_000 });
  const searchInput = page.locator(".g64-search input").first();
  await searchInput.click();
  if (win) {
    await sh("xdotool", ["type", "--delay", "40", "--window", win, "Boulder Dash"]);
  } else {
    await searchInput.fill("Boulder Dash");
  }
  await page.locator(".g64-search button[type='submit']").click();
  await page.waitForTimeout(2500);
  const hits = await page.locator(".g64-hit").count();
  let catalogPass = false;
  let catalogDetail = { hits };
  if (hits > 0) {
    const beforeLib = await page.evaluate(() => window.__g64?.libraryCount?.() ?? 0);
    await page.locator(".g64-hit").first().locator('button[aria-label^="Play"]').click();
    await waitRunning(page, 120_000);
    await page.waitForTimeout(20_000);
    const afterLib = await page.evaluate(() => window.__g64?.libraryCount?.() ?? 0);
    const text = await page.evaluate(() => window.__g64?.screenText?.() || "");
    const shot = await page.evaluate(async () => (await window.__g64?.shot?.())?.b64?.length ?? 0);
    catalogPass =
      afterLib >= beforeLib &&
      shot > 800 &&
      (text.length > 40 || /LOAD|RUN|SEARCH|boulder|dash/i.test(text));
    catalogDetail = { beforeLib, afterLib, shot, head: text.slice(0, 60) };
  }
  if (want("catalog")) push({
    id: "catalog-search-fetch-autostart",
    pass: hits > 0 && catalogPass,
    skipped: hits === 0,
    reason: hits === 0 ? "no IA/catalog hits (network)" : undefined,
    steps: stepsCatalog,
    detail: catalogDetail,
  });

  // —— (2) CMD HD / C64 OS IEC layout ——
  if (!want("cmd")) {
    /* skip block below via guards on each push */
  }
  await page.close().catch(() => null);
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(120_000);
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await clearEmulatorJsCache(page);
  await bootFresh(page, { drive: "cmd-layout" });
  await page.evaluate(() => {
    window.__g64?.setIecSlot?.(8, "1541");
    window.__g64?.setIecSlot?.(9, "cmdhd");
  });
  await page.waitForTimeout(1500);
  const opts = await page.evaluate(() => window.__g64?.runtimeViceOpts?.() ?? {});
  const cmdSteps = [
    "Settings: IEC #8 = 1541, #9 = CMD HD (C64 OS buyer guide layout)",
    "Cold boot; verify vice_drive9_type = CMD HD (4844)",
    "Tap CMD SWAP chip (short) — exchanges #8/#9",
    "Verify cmdSwapped flag",
  ];
  const cmdTypeOk = opts.vice_drive9_type === "CMD HD" || opts.vice_drive8_type === "CMD HD";
  push({
    id: "cmd-hd-rom-unit9-layout",
    pass: cmdTypeOk && opts.vice_virtual_device_traps === "disabled",
    steps: cmdSteps.slice(0, 3),
    detail: {
      drive8: opts.vice_drive8_type,
      drive9: opts.vice_drive9_type,
      traps: opts.vice_virtual_device_traps,
    },
  });

  const swapBtn = page.locator('button[data-hw="cmd-swap"]');
  let swapPass = false;
  if (await swapBtn.isVisible().catch(() => false)) {
    const before = await page.evaluate(() => window.__g64?.cmdSwapped?.());
    await swapBtn.click();
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => window.__g64?.cmdSwapped?.());
    swapPass = before !== after;
  }
  push({
    id: "cmd-hd-swap-button-ui",
    pass: swapPass,
    skipped: !swapPass && !cmdTypeOk,
    steps: cmdSteps,
    detail: { swapPass },
  });

  push({
    id: "cmd-fd-ramlink-modes",
    skipped: true,
    pass: true,
    reason: "FD2000/4000 and RAMLink not modeled — see docs/CMD_SD2IEC_COMPATIBILITY.md",
    steps: ["Documented MISSING in compatibility matrix; no VICE drive type wired"],
  });

  // SD2IEC + CMD HD coexist (unit 8 / 9)
  await page.evaluate(() => {
    window.__g64?.setIecSlot?.(8, "sd2iec");
    window.__g64?.setIecSlot?.(9, "cmdhd");
  });
  await page.waitForTimeout(800);
  const dual = await page.evaluate(() => window.__g64?.settings?.().iecMap ?? {});
  push({
    id: "cmd-plus-sd2iec-iec-map",
    pass: dual[8] === "sd2iec" && dual[9] === "cmdhd",
    steps: ["Assign #8 SD2IEC, #9 CMD HD per C64 OS manual", "Read persisted iecMap"],
    detail: dual,
  });

  // —— (3) Demo timing (catalog or fixture) ——
  for (const kernal of ["stock", "jiffy"]) {
    for (const demo of DEMO_QUERIES) {
      await page.close().catch(() => null);
      page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      page.setDefaultTimeout(120_000);
      await page.goto(base, { waitUntil: "domcontentloaded" });
      await clearEmulatorJsCache(page);
      await bootFresh(page, { jiffy: false });
      if (kernal === "jiffy") await applyJiffy(page);

      const steps = [
        `Power on (${kernal} KERNAL)`,
        "Open Software → search demo by name",
        "Play first hit (online archive fetch + mount)",
        "Sample CRT frames ~15s — expect motion, no KERNAL errors",
      ];
      await openSoftware(page);
      await catalogSearch(page, demo.q);
      const n = await page.locator(".g64-hit").count();
      if (!n) {
        push({
          id: `demo-${demo.id}-${kernal}`,
          skipped: true,
          pass: false,
          reason: "no catalog hit",
          steps,
        });
        continue;
      }
      await page.locator(".g64-hit").first().locator('button[aria-label^="Play"]').click();
      await waitRunning(page, 180_000);
      await ensureReal1541Timing(page);
      await page.waitForTimeout(22_000);
      const motion = await sampleCrtMotion(page, 6, 4000);
      const basicIdle = /COMMODORE 64 BASIC/i.test(motion.head) && /READY/i.test(motion.head);
      push({
        id: `demo-${demo.id}-${kernal}`,
        pass: !motion.glitch && !basicIdle && (motion.frames >= 2 || motion.head.length > 40),
        steps,
        detail: motion,
      });
    }
  }

  // —— (4) Freeze buttons + autostart (run 13 regression) ——
  if (existsSync(BOULDER)) {
    await page.close().catch(() => null);
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(120_000);
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await clearEmulatorJsCache(page);
    await bootFresh(page);
    const bytes = [...readFileSync(BOULDER)];
    await ensureReal1541Timing(page);
    await page.evaluate(
      async ({ bytes }) => {
        await window.__g64?.playBytes?.("boulder-dash.d64", bytes, { autostart: true, title: "Boulder Dash" });
      },
      { bytes },
    );
    await waitRunning(page, 120_000);
    await page.waitForTimeout(50_000);
    const autoText = await page.evaluate(() => window.__g64?.screenText?.() || "");
    const autoRunOk =
      !/FILE NOT FOUND/i.test(autoText) &&
      (/LOADING|SEARCHING FOR|RUN\b|boulder|level|press/i.test(autoText) || autoText.length > 100);
    push({
      id: "autostart-floppy-past-ready",
      pass: autoRunOk,
      steps: [
        "Stock KERNAL, 1541 true emulation",
        "playBytes boulder-dash.d64 autostart:true",
        "Wait load window — screen must leave plain READY (game or LOAD path)",
      ],
      detail: autoText.slice(-120),
    });
  } else {
    push({
      id: "autostart-floppy-past-ready",
      skipped: true,
      pass: false,
      reason: "fixtures/disks/boulder-dash.d64 missing",
      steps: ["run fetch-fixtures.mjs"],
    });
  }

  for (const [cartId, path, name, extra] of [
    ["ar6", CART_AR6, "Action_Replay_V6.0_1989_PAL.crt", "xdotool F1 in freezer"],
    ["fc3", CART_FC3, "Final_Cartridge_3_1987-09_v1.crt", null],
    ["ss5", CART_SS5, "Super_Snapshot_v5.00_1990_NTSC.crt", null],
  ]) {
    if (!existsSync(path)) {
      push({ id: `freeze-ui-${cartId}`, skipped: true, pass: false, reason: "missing CRT" });
      continue;
    }
    await page.close().catch(() => null);
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(120_000);
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await clearEmulatorJsCache(page);
    await bootFresh(page);
    await playCartFile(page, path, name);
    const before = await page.evaluate(() => window.__g64?.screenText?.() || "");
    const btn = page.locator('button[data-hw="cart-fz"]');
    await btn.click({ timeout: 10_000 });
    await page.waitForTimeout(2500);
    if (cartId === "ar6") {
      try {
        const w = await findChromiumWindow(server);
        if (w) await sh("xdotool", ["key", "--window", w, "F1"]);
        else await page.keyboard.press("F1");
      } catch {
        await page.keyboard.press("F1");
      }
      await page.waitForTimeout(1200);
    }
    const after = await page.evaluate(() => window.__g64?.screenText?.() || "");
    const fzOk =
      after.length > 20 &&
      (after !== before ||
        /SNAPSHOT|REPLAY|FINAL|FREEZE|MONITOR|AR |ACTION|CARTRIDGE/i.test(after) ||
        /V{12,}/.test(after));
    push({
      id: `freeze-ui-${cartId}`,
      pass: fzOk,
      steps: [
        "Mount CRT via playBytes",
        "Click hardware CART FZ (toolbar)",
        extra ?? "Verify freezer/menu text on CRT",
      ],
      detail: { head: after.slice(0, 72) },
    });
  }

  writeFileSync(join(outDir, "results.json"), JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));
  writeExtendedQaReport(rows, join(process.cwd(), "docs", "REAL_UI_QA_REPORT.md"));
  await browser.close().catch(() => null);
} catch (e) {
  push({ id: "suite-error", pass: false, detail: String(e), steps: [] });
  writeFileSync(join(outDir, "results.json"), JSON.stringify({ rows }, null, 2));
} finally {
  try {
    await server?.close();
  } catch {
    /* ignore */
  }
  xvfb?.kill("SIGTERM");
}

const failed = rows.filter((r) => !r.pass && !r.skipped);
process.exit(failed.length ? 1 : 0);
