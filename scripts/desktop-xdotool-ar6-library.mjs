#!/usr/bin/env node
/**
 * Real UI: Jiffy ON → Software → On this device → import AR6 PAL → Play → 20s screenshot.
 *   npm run test:desktop-xdotool-ar6-library
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  canvasLooksLikeCartMenu,
  canvasPixelStats,
  patchLocalStorage,
  powerOnDesktop,
  waitRunning,
} from "./desktop-qa-lib.mjs";
import { assertGrok64WasmCore, clearEmulatorJsCache, grok64DatapathFromEnv } from "./desktop-grok64-core.mjs";
import { CART_COMPAT_CATALOG, cartFixturePath } from "./cart-compat-catalog.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const display = process.env.GROK64_XDISPLAY || ":99";
const outDir = join(process.cwd(), "screenshots", "ar6-library-jiffy");
const artDir = join(process.cwd(), "artifacts", "desktop-xdotool-ar6-library");
mkdirSync(outDir, { recursive: true });
mkdirSync(artDir, { recursive: true });

const ar6Entry = CART_COMPAT_CATALOG.find((c) => c.id === "ar6");
const ar6Path = ar6Entry ? cartFixturePath(ar6Entry) : join(process.cwd(), "fixtures/carts/ar6.crt");
if (!existsSync(ar6Path)) {
  console.error("missing ar6 fixture — run node scripts/fetch-fixtures.mjs");
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
const pair = synthJiffyPair();
await page.evaluate(async (roms) => {
  for (const [name, bytes] of Object.entries(roms)) {
    const id = /1541/i.test(name) ? "jiffy-1541" : "jiffy-c64";
    await window.__g64?.putRomBytes?.(id, name, bytes);
  }
  window.__g64?.setJiffyDos?.(true);
}, pair);
await page.reload({ waitUntil: "domcontentloaded" });
await powerOnDesktop(page, base, { navigate: false });
await waitRunning(page, 120_000);
await page.waitForFunction(
  () => /JIFFYDOS/i.test(window.__g64?.screenText?.() || "") || window.__g64?.jiffyLive?.() === true,
  { timeout: 120_000 },
);

const ar6Name = "Action_Replay_V6.0_6.0_1989_PAL.crt";
const ar6Bytes = [...readFileSync(ar6Path)];
await page.evaluate(
  async ({ name, bytes }) => window.__g64?.importLibraryBytes?.(name, bytes),
  { name: ar6Name, bytes: ar6Bytes },
);
await page.locator('button[aria-label="Software"]').click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: /On this device/i }).click();
await page.waitForTimeout(400);
const playCard = page.locator(".g64-card strong").filter({ hasText: /Action_Replay_V6/i }).first();
await playCard.waitFor({ timeout: 20_000 });
await playCard.click();
await waitRunning(page, 180_000);
await page.waitForTimeout(20_000);

const text = await page.evaluate(() => window.__g64?.screenText?.() || "");
const opts = await page.evaluate(() => window.__g64?.runtimeViceOpts?.() ?? {});
const jiffyLive = await page.evaluate(() => window.__g64?.jiffyLive?.());
const cart = await canvasLooksLikeCartMenu(page);
const stats = await canvasPixelStats(page);
const purpleWash = stats?.ok && stats.buckets <= 6 && stats.geosDesk < 0.02 && stats.ink < 0.01;
await page.screenshot({ path: join(outDir, "ar6-20s-library-jiffy-ntsc-settings.png"), fullPage: true });

const report = {
  jiffyLive,
  viceModel: opts.vice_c64_model,
  palette: opts.vice_external_palette,
  arText: /REPLAY|ACTION/i.test(text),
  purpleWash,
  cartCanvas: cart.pass,
  textHead: text.slice(0, 120),
  stats,
  pass: /REPLAY|ACTION/i.test(text) && !purpleWash && jiffyLive === false,
};
writeFileSync(join(artDir, "results.json"), JSON.stringify(report, null, 2));
console.log(report.pass ? "PASS ar6-library-jiffy" : "FAIL ar6-library-jiffy", JSON.stringify(report));

await browser.close();
await server.close();
xvfb.kill("SIGTERM");
process.exit(report.pass ? 0 : 1);
