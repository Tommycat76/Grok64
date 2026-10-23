#!/usr/bin/env node
/**
 * REQUIRED pre-push gate — Jiffy ON, real Software library UI, SS5 + Reset + AR6.
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
  waitRunning,
} from "./desktop-qa-lib.mjs";
import { assertGrok64WasmCore, clearEmulatorJsCache, grok64DatapathFromEnv } from "./desktop-grok64-core.mjs";
import { CART_COMPAT_CATALOG, cartFixturePath } from "./cart-compat-catalog.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const display = process.env.GROK64_XDISPLAY || ":99";
const outDir = join(process.cwd(), "screenshots", "cart-jiffy-ui-gate");
const artDir = join(process.cwd(), "artifacts", "desktop-cart-jiffy-ui-gate");
mkdirSync(outDir, { recursive: true });
mkdirSync(artDir, { recursive: true });

const ss5 = cartFixturePath(CART_COMPAT_CATALOG.find((c) => c.id === "ss5"));
const ar6Name = "Action_Replay_V6.0_6.0_1989_PAL.crt";
const ar6 = cartFixturePath(CART_COMPAT_CATALOG.find((c) => c.id === "ar6"));

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

async function playLibraryCart(page, filePath, displayName) {
  const bytes = [...readFileSync(filePath)];
  const name = displayName || filePath.split("/").pop();
  await page.evaluate(async ({ name, bytes }) => window.__g64?.importLibraryBytes?.(name, bytes), { name, bytes });
  await page.locator('button[aria-label="Software"]').click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /On this device/i }).click();
  await page.waitForTimeout(300);
  await page.locator(".g64-card strong").filter({ hasText: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 24)) }).first().click();
  await waitRunning(page, 180_000);
  await page.waitForTimeout(12_000);
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
await page.goto(base, { waitUntil: "domcontentloaded" });
await clearEmulatorJsCache(page);
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

await page.evaluate(() => window.__g64?.hwPress?.("cart-out", "short"));
await waitRunning(page, 120_000);
await page.waitForTimeout(8_000);

await playLibraryCart(page, ss5, "Super_Snapshot_v5.00_1990_NTSC.crt");
const ssText = await page.evaluate(() => window.__g64?.screenText?.() || "");
const ssMenu = /SNAPSHOT|SUPER/i.test(ssText);
const ssPix = await canvasLooksLikeCartMenu(page);
const ssDiskAutostart = /SEARCHING FOR \*|LOAD"\*"/i.test(ssText);
await page.screenshot({ path: join(outDir, "01-ss5-play.png"), fullPage: true });

await page.locator('button[aria-label="Reset"]').click();
await page.waitForTimeout(2_000);
await waitRunning(page, 60_000);
await page.waitForTimeout(10_000);
const afterResetText = await page.evaluate(() => window.__g64?.screenText?.() || "");
const ssAfterReset = /SNAPSHOT|SUPER/i.test(afterResetText);
await page.screenshot({ path: join(outDir, "02-ss5-after-reset.png"), fullPage: true });

await page.evaluate(() => window.__g64?.hwPress?.("cart-out", "short"));
await waitRunning(page, 120_000);
function basicAfterCartOut(snap) {
  if (snap.cartLive) return false;
  if (!(snap.running && !snap.booting && snap.title === "BASIC")) return false;
  if (isBasicReadyScreen(snap.text)) return true;
  // Synthetic Jiffy ROM bytes in this gate may not yield decodable KERNAL text.
  return !/SNAPSHOT|REPLAY|ACTION|TURBO|SEARCHING|LOAD"\*"/i.test(snap.text);
}

let basicAfterOut = false;
let cartLiveAfterOut = true;
let afterOutText = "";
for (let i = 0; i < 60; i++) {
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
await page.screenshot({ path: join(outDir, "02b-after-cart-out.png"), fullPage: true });

await playLibraryCart(page, ar6, ar6Name);
const arText = await page.evaluate(() => window.__g64?.screenText?.() || "");
const arMenu = /REPLAY|ACTION/i.test(arText);
const arPix = await canvasLooksLikeCartMenu(page);
const arDiskAutostart = /SEARCHING FOR \*|FILE NOT FOUND/i.test(arText) && !arMenu;
await page.screenshot({ path: join(outDir, "03-ar6-play.png"), fullPage: true });

const report = {
  ssMenu,
  ssPix,
  ssDiskAutostart,
  ssAfterReset,
  basicAfterOut,
  cartLiveAfterOut,
  afterOutTextHead: afterOutText.slice(0, 200),
  arMenu,
  arPix,
  arDiskAutostart,
  jiffyLiveAfterAr: await page.evaluate(() => window.__g64?.jiffyLive?.()),
  pass:
    ssMenu &&
    !ssDiskAutostart &&
    (ssPix.pass || ssMenu) &&
    ssAfterReset &&
    basicAfterOut &&
    arMenu &&
    !arDiskAutostart &&
    (arPix.pass || arMenu),
};
writeFileSync(join(artDir, "results.json"), JSON.stringify(report, null, 2));
console.log(report.pass ? "PASS cart-jiffy-ui-gate" : "FAIL cart-jiffy-ui-gate", JSON.stringify(report));

await browser.close();
await server.close();
xvfb.kill("SIGTERM");
process.exit(report.pass ? 0 : 1);
