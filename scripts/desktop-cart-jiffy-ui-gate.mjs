#!/usr/bin/env node
/**
 * REQUIRED pre-push gate — Jiffy ON, real Software library UI, SS5 + Reset + AR6.
 * Mirrors hands-on: play cart → F5 resume → CART OUT → Software › On this device › Play.
 *   npm run test:desktop-cart-jiffy-ui-gate
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  canvasLooksLikeCartMenu,
  isBasicReadyScreen,
  patchLocalStorage,
  powerOnDesktop,
  waitForG64,
  waitRunning,
} from "./desktop-qa-lib.mjs";
import {
  assertGrok64WasmCore,
  clearEmulatorJsCache,
  grok64DatapathFromEnv,
  installGrok64CoreNetworkGuard,
} from "./desktop-grok64-core.mjs";
import { CART_COMPAT_CATALOG, cartFixturePath } from "./cart-compat-catalog.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const display = process.env.GROK64_XDISPLAY || ":99";
const outDir = join(process.cwd(), "screenshots", "cart-jiffy-ui-gate");
const artDir = join(process.cwd(), "artifacts", "desktop-cart-jiffy-ui-gate");
mkdirSync(outDir, { recursive: true });
mkdirSync(artDir, { recursive: true });

const ss5Entry = CART_COMPAT_CATALOG.find((c) => c.id === "ss5");
const ar6Entry = CART_COMPAT_CATALOG.find((c) => c.id === "ar6");
const ss5 = cartFixturePath(ss5Entry);
const ar6 = cartFixturePath(ar6Entry);
const ss5Display = "Super_Snapshot_v5.00_1990_NTSC.crt";
const ar6Display = "Action_Replay_V6.0_6.0_1989_PAL.crt";

if (!existsSync(ss5) || !existsSync(ar6)) {
  console.error("missing cart fixtures");
  process.exit(1);
}
if (!grok64DatapathFromEnv()) {
  console.error("VITE_GROK64_VICE_DATAPATH missing");
  process.exit(1);
}

function synthJiffyPair() {
  const c64 = new Uint8Array(8192).fill(0x4a);
  const d41 = new Uint8Array(8192).fill(0x41);
  return {
    "JiffyDOS_C64_6.01.bin": [...c64],
    "JiffyDOS_1541-II_6.00.bin": [...d41],
  };
}

/** After F5 the splash power chip may be hidden while zustand is still rehydrating. */
async function ensureEmuLive(page) {
  await waitForG64(page);
  for (let i = 0; i < 100; i++) {
    const st = await page.evaluate(() => ({
      fs: Boolean(window.__g64?.hasFs?.()),
      powered: Boolean(window.__g64?.powered?.()),
    }));
    if (st.fs) return true;
    if (!st.powered) {
      await page.evaluate(() => {
        document.querySelector(".g64-power")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        document.querySelector(".g64-splash")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }
    await page.waitForTimeout(400);
  }
  return await page.evaluate(() => Boolean(window.__g64?.hasFs?.()));
}

async function bootJiffyOn(page) {
  await patchLocalStorage(page, { video: "ntsc", jiffy: true });
  await page.reload({ waitUntil: "domcontentloaded" });
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
  await assertGrok64WasmCore(page, { timeoutMs: 120_000 });
  await page.evaluate(async (roms) => {
    for (const [name, bytes] of Object.entries(roms)) {
      const id = /1541/i.test(name) ? "jiffy-1541" : "jiffy-c64";
      await window.__g64?.putRomBytes?.(id, name, bytes);
    }
    window.__g64?.setJiffyDos?.(true);
  }, synthJiffyPair());
  await page.reload({ waitUntil: "domcontentloaded" });
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
}

async function importCart(page, filePath, displayName) {
  const bytes = [...readFileSync(filePath)];
  const name = displayName || filePath.split("/").pop();
  await page.evaluate(async ({ name, bytes }) => window.__g64?.importLibraryBytes?.(name, bytes), {
    name,
    bytes,
  });
  return name;
}

/** Software › On this device › Play (icon) — same path as hands-on. */
async function playLibraryCart(page, displayName) {
  const esc = displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page.locator('button[aria-label="Software"]').click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /On this device/i }).click();
  await page.waitForTimeout(400);
  const card = page.locator(".g64-card").filter({ hasText: new RegExp(esc.slice(0, 28)) });
  await card.locator('button[aria-label^="Play"]').click();
  await waitRunning(page, 180_000);
  await page.waitForFunction(() => window.__g64?.sessionFlags?.().cart === true, { timeout: 120_000 });
  await page.waitForFunction(
    () => {
      const t = window.__g64?.screenText?.() || "";
      return !/LOAD"\*"|SEARCHING FOR \*/i.test(t);
    },
    { timeout: 120_000 },
  );
  await page.waitForTimeout(8_000);
}

function diskAutostartPoison(text) {
  return /SEARCHING FOR \*|LOAD"\*"|FILE NOT FOUND/i.test(text);
}

function basicAfterCartOut(snap) {
  if (snap.cartLive) return false;
  if (!(snap.running && !snap.booting && snap.title === "BASIC")) return false;
  if (isBasicReadyScreen(snap.text)) return true;
  return !/SNAPSHOT|REPLAY|ACTION|TURBO|SEARCHING|LOAD"\*"/i.test(snap.text);
}

async function waitCartPixels(page, { minBuckets = 3 } = {}) {
  for (let i = 0; i < 50; i++) {
    const pix = await canvasLooksLikeCartMenu(page, { minBuckets });
    if (pix.pass) return pix;
    await page.waitForTimeout(1_500);
  }
  return await canvasLooksLikeCartMenu(page, { minBuckets });
}

async function waitForCartMenu(page, menuRe, { ms = 90_000 } = {}) {
  const t0 = Date.now();
  let last = { text: "", pix: { pass: false, stats: {} } };
  while (Date.now() - t0 < ms) {
    const text = await page.evaluate(() => window.__g64?.screenText?.() || "");
    const pix = await canvasLooksLikeCartMenu(page, { minBuckets: 28 });
    last = { text, pix };
    if (diskAutostartPoison(text) && !menuRe.test(text)) break;
    if (menuRe.test(text) && pix.pass) return { ok: true, text, pix };
    await page.waitForTimeout(1_500);
  }
  return { ok: false, ...last };
}

async function pressCartOut(page) {
  await page.evaluate(() => window.__g64?.hwPress?.("cart-out", "short"));
  await waitRunning(page, 120_000);
}

const xvfb = spawn("Xvfb", [display, "-screen", "0", "1280x800x24", "-ac"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 600));
const server = await chromium.launchServer({
  headless: false,
  env: { ...process.env, DISPLAY: display },
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1280,800"],
});
const browser = await chromium.connect(server.wsEndpoint());
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
await page.goto(base, { waitUntil: "domcontentloaded" });
if (grok64DatapathFromEnv()) await installGrok64CoreNetworkGuard(page, base);
await clearEmulatorJsCache(page);
await bootJiffyOn(page);

await importCart(page, ss5, ss5Display);
await playLibraryCart(page, ss5Display);
await page.screenshot({ path: join(outDir, "01-ss5-first-play.png"), fullPage: true });

await page.reload({ waitUntil: "domcontentloaded" });
await ensureEmuLive(page);
await waitRunning(page, 180_000);
const resumedHint = await page.evaluate(() => Boolean(document.body?.innerText?.includes("Resumed your last session")));
await page.screenshot({ path: join(outDir, "01b-after-f5.png"), fullPage: true });

await pressCartOut(page);
let basicAfterOut = false;
let cartLiveAfterOut = true;
let afterOutText = "";
for (let i = 0; i < 75; i++) {
  await page.waitForTimeout(1_000);
  const snap = await page.evaluate(() => ({
    text: window.__g64?.screenText?.() || "",
    cartLive: window.__g64?.cartLive?.() ?? true,
    running: Boolean(window.__g64?.running?.()),
    booting: Boolean(window.__g64?.booting?.()),
    title: window.__g64?.title?.() || "",
  }));
  cartLiveAfterOut = snap.cartLive;
  afterOutText = snap.text;
  if (basicAfterCartOut(snap)) {
    basicAfterOut = true;
    break;
  }
}
await page.screenshot({ path: join(outDir, "02-after-cart-out.png"), fullPage: true });

const ssMenuRe = /SNAPSHOT|SUPER|TURBO/i;
await playLibraryCart(page, ss5Display);
const ss2 = await waitForCartMenu(page, ssMenuRe);
const ssText = ss2.text || (await page.evaluate(() => window.__g64?.screenText?.() || ""));
const ssPix = ss2.pix?.pass ? ss2.pix : await waitCartPixels(page, { minBuckets: 3 });
const ssMenu = ssMenuRe.test(ssText);
const ssDiskAutostart = diskAutostartPoison(ssText);
await page.screenshot({ path: join(outDir, "03-ss5-after-resume-play.png"), fullPage: true });

await page.locator('button[aria-label="Reset"]').click();
await page.waitForTimeout(2_000);
await waitRunning(page, 90_000);
await page.waitForTimeout(12_000);
const afterResetText = await page.evaluate(() => window.__g64?.screenText?.() || "");
const ssAfterResetPix = await canvasLooksLikeCartMenu(page, { minBuckets: 4 });
const ssAfterReset = ssMenuRe.test(afterResetText) && ssAfterResetPix.pass;
await page.screenshot({ path: join(outDir, "04-ss5-after-reset.png"), fullPage: true });

await pressCartOut(page);
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(1_000);
  if (!(await page.evaluate(() => window.__g64?.cartLive?.()))) break;
}

await importCart(page, ar6, ar6Display);
await playLibraryCart(page, ar6Display);
const arMenuRe = /REPLAY|ACTION/i;
const arWait = await waitForCartMenu(page, arMenuRe);
const arText = arWait.text || (await page.evaluate(() => window.__g64?.screenText?.() || ""));
const arPix = arWait.pix?.pass ? arWait.pix : await waitCartPixels(page, { minBuckets: 3 });
const arMenu = arMenuRe.test(arText);
const arDiskAutostart = diskAutostartPoison(arText) && !arMenu;
await page.screenshot({ path: join(outDir, "05-ar6-play.png"), fullPage: true });

const report = {
  resumedHint,
  ssMenu,
  ssPix,
  ssDiskAutostart,
  ssAfterResumePlay: ss2.ok,
  ssAfterReset,
  ssAfterResetPix,
  basicAfterOut,
  cartLiveAfterOut,
  afterOutTextHead: afterOutText.slice(0, 200),
  arMenu,
  arPix,
  arDiskAutostart,
  jiffyLiveAfterAr: await page.evaluate(() => window.__g64?.jiffyLive?.()),
  consoleErrorCount: consoleErrors.length,
  pass:
    ssMenu &&
    !ssDiskAutostart &&
    ss2.ok &&
    !diskAutostartPoison(ssText) &&
    ssAfterReset &&
    ssAfterResetPix.pass &&
    basicAfterOut &&
    !cartLiveAfterOut &&
    arMenu &&
    arPix.pass &&
    !arDiskAutostart,
};
writeFileSync(join(artDir, "results.json"), JSON.stringify(report, null, 2));
console.log(report.pass ? "PASS cart-jiffy-ui-gate" : "FAIL cart-jiffy-ui-gate", JSON.stringify(report));

await browser.close();
await server.close();
xvfb.kill("SIGTERM");
if (!report.pass) process.exitCode = 1;
process.exit(report.pass ? 0 : 1);
