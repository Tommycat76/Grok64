#!/usr/bin/env node
/**
 * Real UI: SS5 Play → toolbar Reset → AR6 Play (catches cart leak + PAL AR6).
 *   npm run test:desktop-cart-reset-sequence
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

function cartById(id) {
  const entry = CART_COMPAT_CATALOG.find((c) => c.id === id);
  if (!entry) throw new Error(`unknown cart id ${id}`);
  return entry;
}

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const display = process.env.GROK64_XDISPLAY || ":99";
const outDir = join(process.cwd(), "screenshots", "cart-reset-sequence");
const artDir = join(process.cwd(), "artifacts", "desktop-cart-reset-sequence");
mkdirSync(outDir, { recursive: true });
mkdirSync(artDir, { recursive: true });

const ss5 = cartFixturePath(cartById("ss5"));
const ar6 = cartFixturePath(cartById("ar6"));
if (!existsSync(ss5) || !existsSync(ar6)) {
  console.error("missing fixtures — run node scripts/fetch-fixtures.mjs");
  process.exit(1);
}
if (!grok64DatapathFromEnv()) {
  console.error("VITE_GROK64_VICE_DATAPATH missing");
  process.exit(1);
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
await patchLocalStorage(page, { video: "pal", jiffy: false });
await page.reload({ waitUntil: "domcontentloaded" });
await powerOnDesktop(page, base, { navigate: false });
await waitRunning(page, 120_000);
await assertGrok64WasmCore(page, { timeoutMs: 120_000 });

async function playFixture(path, label) {
  const bytes = [...readFileSync(path)];
  const name = path.split("/").pop();
  await page.evaluate(
    async ({ name, bytes, title }) => {
      await window.__g64?.playBytes?.(name, bytes, { autostart: true, title });
    },
    { name, bytes, title: label },
  );
  await waitRunning(page, 180_000);
  await page.waitForTimeout(12_000);
}

await playFixture(ss5, "Super Snapshot 5");
const ssText = await page.evaluate(() => window.__g64?.screenText?.() || "");
const ssMenu = /SNAPSHOT|SUPER/i.test(ssText);
await page.screenshot({ path: join(outDir, "01-ss5-menu.png"), fullPage: true });

await page.locator('button[aria-label="Reset"]').click();
await page.waitForTimeout(2_000);
await waitRunning(page, 60_000);
await page.waitForTimeout(10_000);
const afterResetText = await page.evaluate(() => window.__g64?.screenText?.() || "");
const ssAfterReset = /SNAPSHOT|SUPER/i.test(afterResetText);
const cartUiAfterReset = await page.evaluate(() => window.__g64?.cartLive?.() ?? false);
await page.screenshot({ path: join(outDir, "02-after-reset.png"), fullPage: true });

await page.evaluate(() => window.__g64?.hwPress?.("cart-out", "short"));
await page.waitForTimeout(3_000);
await waitRunning(page, 120_000);
await page.waitForTimeout(10_000);
const afterEjectText = await page.evaluate(() => window.__g64?.screenText?.() || "");
const basicAfterEject = isBasicReadyScreen(afterEjectText);
const cartUiAfterEject = await page.evaluate(() => window.__g64?.cartLive?.() ?? false);
await page.screenshot({ path: join(outDir, "02b-after-cart-out.png"), fullPage: true });

await playFixture(ar6, "Action Replay 6");
const arText = await page.evaluate(() => window.__g64?.screenText?.() || "");
const arMenu = /REPLAY|ACTION/i.test(arText);
const arCanvas = await canvasLooksLikeCartMenu(page);
await page.screenshot({ path: join(outDir, "03-ar6-after-sequence.png"), fullPage: true });

const report = {
  ssMenu,
  ssAfterReset,
  cartUiAfterReset,
  basicAfterEject,
  cartUiAfterEject,
  arMenu,
  arCanvas,
  pass:
    ssMenu &&
    ssAfterReset &&
    cartUiAfterReset &&
    basicAfterEject &&
    !cartUiAfterEject &&
    (arMenu || arCanvas.pass),
};
writeFileSync(join(artDir, "results.json"), JSON.stringify(report, null, 2));
console.log(report.pass ? "PASS cart-reset-sequence" : "FAIL cart-reset-sequence", JSON.stringify(report));

await browser.close();
await server.close();
xvfb.kill("SIGTERM");
process.exit(report.pass ? 0 : 1);
