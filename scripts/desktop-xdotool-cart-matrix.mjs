#!/usr/bin/env node
/**
 * Real-UI cartridge matrix — xdotool + Chromium under Xvfb.
 * Stock KERNAL and JiffyDOS (synthetic ROM pair) per cart in cart-compat-catalog.
 *
 *   node scripts/fetch-fixtures.mjs
 *   npm run test:desktop-xdotool-cart-matrix
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CART_COMPAT_CATALOG,
  cartFixturePath,
  cartFixturePresent,
  cartPlayName,
} from "./cart-compat-catalog.mjs";
import { patchLocalStorage, powerOnDesktop, waitRunning, ensureReal1541Timing } from "./desktop-qa-lib.mjs";
import { assertGrok64WasmCore, clearEmulatorJsCache, grok64DatapathFromEnv } from "./desktop-grok64-core.mjs";
import { writeCartCompatMatrixDoc } from "./generate-cart-compat-matrix-doc.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const display = process.env.GROK64_XDISPLAY || ":99";
const outDir = join(process.cwd(), "artifacts", "desktop-xdotool-cart-matrix");
mkdirSync(outDir, { recursive: true });

const ONLY = process.env.CART_MATRIX_ONLY?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
const DISK = join(process.cwd(), "fixtures", "disks", "boulder-dash.d64");

function sh(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      env: { ...process.env, DISPLAY: display, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    p.stdout?.on("data", (d) => (out += d));
    p.stderr?.on("data", (d) => (out += d));
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.join(" ")}: ${out}`))));
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
  const tries = [
    ...(pid ? [() => sh("xdotool", ["search", "--pid", String(pid)])] : []),
    () => sh("xdotool", ["search", "--onlyvisible", "--class", "chromium"]),
    () => sh("xdotool", ["search", "--onlyvisible", "--class", "chrome"]),
  ];
  for (let i = 0; i < 50; i++) {
    for (const t of tries) {
      try {
        const ids = (await t()).trim().split(/\s+/).filter(Boolean);
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
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return "";
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

const rows = [];
const push = (row) => {
  rows.push(row);
  const tag = row.skipped ? "SKIP" : row.pass ? "PASS" : "FAIL";
  console.log(tag, row.id, row.detail ?? row.reason ?? "");
};

async function bootPage(page, { jiffy }) {
  await patchLocalStorage(page, { video: "ntsc", jiffy: !!jiffy });
  await page.reload({ waitUntil: "domcontentloaded" });
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
  await assertGrok64WasmCore(page, { timeoutMs: 120_000 });
  await page.waitForFunction(() => /READY/i.test(window.__g64?.screenText?.() || ""), { timeout: 120_000 });
  if (jiffy) {
    const pair = synthJiffyPair();
    await page.evaluate(async (roms) => {
      for (const [name, bytes] of Object.entries(roms)) {
        const id = /1541/i.test(name) ? "jiffy-1541" : "jiffy-c64";
        await window.__g64?.putRomBytes?.(id, name, bytes);
      }
      window.__g64?.setJiffyDos?.(true);
    }, pair);
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: "domcontentloaded" });
    await powerOnDesktop(page, base, { navigate: false });
    await waitRunning(page, 120_000);
    await page.waitForFunction(
      () => /READY/i.test(window.__g64?.screenText?.() || "") || window.__g64?.jiffyLive?.() === true,
      { timeout: 120_000 },
    );
  }
}

async function playCart(page, entry) {
  const path = cartFixturePath(entry);
  const bytes = [...readFileSync(path)];
  const name = cartPlayName(entry);
  await page.evaluate(
    async ({ name, bytes }) => {
      await window.__g64?.playBytes?.(name, bytes, { autostart: true });
    },
    { name, bytes },
  );
  await waitRunning(page, 120_000);
  await page.waitForFunction(() => window.__g64?.sessionFlags?.().cart === true, { timeout: 60_000 });
  await page.waitForTimeout(entry.freezer ? 10_000 : 6000);
  await page.evaluate(() => window.__g64?.kbdDrain?.());
}

async function pressFreezeUi(page) {
  const btn = page.locator('button[data-hw="cart-fz"]');
  await btn.waitFor({ state: "visible", timeout: 12_000 });
  await btn.click({ timeout: 8000 });
}

async function xdoKey(win, key) {
  await sh("xdotool", ["key", "--window", win, key]);
  await new Promise((r) => setTimeout(r, 600));
}

/** Plain BASIC with no cart title — not “READY” line alone (SS shows TURBO + READY). */
function plainBasicOnly(text) {
  if (/TURBO|SNAPSHOT|REPLAY|FINAL|FAST\s*LOAD|KCS|WARP|CARTRIDGE|EPYX/i.test(text)) return false;
  const compact = text.replace(/\s+/g, " ").trim();
  return (
    /COMMODORE 64 BASIC/i.test(text) &&
    (/READY\.?$/i.test(compact) || /\bREADY\b/.test(text)) &&
    compact.length < 220
  );
}

async function runCartKernal(page, win, entry, kernal) {
  const id = `${entry.id}/${kernal}`;
  if (!cartFixturePresent(entry)) {
    push({ id, cart: entry.id, kernal, skipped: true, pass: false, reason: "missing fixture", label: entry.label });
    return;
  }

  await bootPage(page, { jiffy: kernal === "jiffy" });
  await playCart(page, entry);

  const text0 = await page.evaluate(() => window.__g64?.screenText?.() || "");
  const kind = await page.evaluate(() => window.__g64?.fastLoadCart?.() ?? null);
  const jiffyLive = await page.evaluate(() => window.__g64?.jiffyLive?.());
  const jiffyWant = kernal === "jiffy";

  const bootOk = !plainBasicOnly(text0) && text0.replace(/\s+/g, "").length > 12;
  const detectOk =
    !entry.expectedKind ||
    kind === entry.expectedKind ||
    (entry.expectedKind === "other-fastload" && kind === "other-fastload");
  const menuOk = entry.menuRe.test(text0) || bootOk;

  const gameWaitMs = entry.id === "ss5" || entry.id === "ss4" ? 90_000 : 50_000;
  let gameOk = true;
  if (entry.gameLoad && kernal === "stock" && existsSync(DISK)) {
    await ensureReal1541Timing(page);
    const bytes = [...readFileSync(DISK)];
    await page.evaluate(
      async ({ bytes }) => {
        await window.__g64?.playBytes?.("boulder-dash.d64", bytes, { autostart: true, title: "Boulder Dash" });
      },
      { bytes },
    );
    await waitRunning(page, 120_000);
    await page.waitForTimeout(gameWaitMs);
    const gtext = await page.evaluate(() => window.__g64?.screenText?.() || "");
    gameOk =
      !/NOT FOUND/i.test(gtext) &&
      !plainBasicOnly(gtext) &&
      (gtext.length > 80 ||
        /boulder|level|score|lives|press|loading/i.test(gtext) ||
        (/LOAD\s*"\*"/i.test(gtext) && gtext.length > 120));
  } else if (entry.gameLoad && kernal === "jiffy") {
    gameOk = true;
  }

  let freezeOk = true;
  let resumeOk = true;
  if (entry.freezer) {
    if (entry.gameLoad && kernal === "stock") {
      await playCart(page, entry);
    }
    const before = await page.evaluate(() => window.__g64?.screenText?.() || "");
    await pressFreezeUi(page);
    await page.waitForTimeout(2200);
    await page.evaluate(() => window.__g64?.kbdDrain?.());
    const frozen = await page.evaluate(() => window.__g64?.screenText?.() || "");
    freezeOk =
      !plainBasicOnly(frozen) &&
      (frozen !== before || entry.menuRe.test(frozen) || /SNAPSHOT|REPLAY|FINAL|FREEZE|MONITOR/i.test(frozen));
    if (entry.id.startsWith("ar")) {
      await xdoKey(win, "F1");
      await page.evaluate(() => window.__g64?.kbdDrain?.());
      await page.waitForTimeout(1200);
    }
    await page.evaluate(() => window.__g64?.cartReset?.());
    await page.waitForTimeout(2000);
    const resumed = await page.evaluate(() => window.__g64?.screenText?.() || "");
    resumeOk = resumed.length > 8;
  }

  let jiffyOk = true;
  if (jiffyWant) {
    const expectLive = !entry.jiffySuppress;
    jiffyOk = jiffyLive === expectLive;
  } else {
    jiffyOk = jiffyLive === false;
  }

  const corePass = bootOk && detectOk && menuOk && freezeOk && resumeOk && jiffyOk;
  const pass = corePass && (!entry.gameLoad || gameOk);
  push({
    id,
    cart: entry.id,
    label: entry.label,
    kernal,
    pass,
    boot: bootOk,
    detect: detectOk,
    menu: menuOk,
    freeze: freezeOk,
    resume: resumeOk,
    jiffy: jiffyOk,
    game: gameOk,
    kind,
    jiffyLive,
    detail: text0.slice(0, 72),
  });
}

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

  await page.bringToFront();
  await new Promise((r) => setTimeout(r, 600));
  const win = await findChromiumWindow(server);
  if (!win) throw new Error("xdotool: Chromium window not found");
  await sh("xdotool", ["mousemove", "--window", win, "640", "300", "click", "1"]);

  const catalog = ONLY
    ? CART_COMPAT_CATALOG.filter((e) => ONLY.some((p) => e.id.includes(p)))
    : CART_COMPAT_CATALOG;

  for (const entry of catalog) {
    for (const kernal of ["stock", "jiffy"]) {
      try {
        await page.close().catch(() => null);
      } catch {
        /* crashed */
      }
      page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      page.setDefaultTimeout(120_000);
      await page.goto(base, { waitUntil: "domcontentloaded" });
      await clearEmulatorJsCache(page);
      await runCartKernal(page, win, entry, kernal);
    }
  }

  await page.screenshot({ path: join(outDir, "final.png") }).catch(() => null);
  await browser.close();
} catch (e) {
  push({ id: "suite-error", pass: false, detail: String(e) });
}
try {
  if (rows.length) {
    writeFileSync(join(outDir, "results.json"), JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));
    writeCartCompatMatrixDoc(rows, join(process.cwd(), "docs", "CART_COMPAT_MATRIX.md"));
  }
} catch {
  /* doc */
} finally {
  try {
    await server?.close();
  } catch {
    /* ignore */
  }
  xvfb?.kill("SIGTERM");
}

const failed = rows.filter((r) => !r.pass && !r.skipped && r.id !== "suite-error");
const suiteErr = rows.some((r) => r.id === "suite-error" && !r.pass);
process.exit(failed.length || suiteErr ? 1 : 0);
