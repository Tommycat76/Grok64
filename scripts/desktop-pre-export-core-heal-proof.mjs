#!/usr/bin/env node
/**
 * Long-used dirty profile: a real pre-disk-export VICE core in every cache
 * (EmulatorJS-core / roms / bios / states, EmulatorJS-Cache, Cache Storage,
 * canonical + CDN URLs, versioned keys) plus the Tom heal-trap sessionStorage.
 * Power must swap in the current IEC blob with no CDN vice requests. Then
 * real Software Insert of GEOS and LIST.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import {
  assertGrok64WasmCore,
  grok64CoreBuildIdFromManifest,
  grok64CoreGlueShaFromManifest,
  grok64DatapathFromEnv,
  installGrok64CoreNetworkMonitor,
} from "./desktop-grok64-core.mjs";
import {
  geosFloppyEvidence,
  openSoftware,
  patchLocalStorage,
  powerOnDesktop,
  typeBasic,
  waitForG64,
  waitRunning,
} from "./desktop-qa-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const outDir = join(process.cwd(), "artifacts", "desktop-pre-export-core-heal");
const shotDir = join(process.cwd(), "screenshots");
mkdirSync(outDir, { recursive: true });
mkdirSync(shotDir, { recursive: true });

spawnSync(process.execPath, ["scripts/prepare-floppy-fixtures.mjs"], { stdio: "inherit" });

const buildId = grok64CoreBuildIdFromManifest();
const glueSha = grok64CoreGlueShaFromManifest();
const d64Path =
  process.env.GROK64_GEOS_D64_PATH ||
  (existsSync(join(process.cwd(), "fixtures", "geos", "GEOS_2.0.d64"))
    ? join(process.cwd(), "fixtures", "geos", "GEOS_2.0.d64")
    : existsSync("/tmp/g64media/g64media/GEOS Boot Disk.d64")
      ? "/tmp/g64media/g64media/GEOS Boot Disk.d64"
      : null);

if (!grok64DatapathFromEnv() || !buildId || !glueSha || !d64Path) {
  console.log(JSON.stringify({ pass: false, skipped: true, reason: "missing env, manifest, or GEOS d64" }));
  process.exit(0);
}

const IEC_BYTES = 2_446_835;
const stockCache = "/tmp/g64-stock-vice_x64sc-wasm.data";

async function loadPreExportCoreBytes() {
  if (existsSync(stockCache) && statSync(stockCache).size > 100_000 && statSync(stockCache).size !== IEC_BYTES) {
    return readFileSync(stockCache);
  }
  const res = await fetch("https://cdn.emulatorjs.org/stable/data/cores/vice_x64sc-wasm.data");
  if (!res.ok) throw new Error(`stock core fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === IEC_BYTES) throw new Error("CDN stock is the current IEC blob — cannot seed a pre-export core");
  if (buf.length < 100_000) throw new Error(`stock core too small (${buf.length})`);
  writeFileSync(stockCache, buf);
  return buf;
}

const d64Name = d64Path.split("/").pop() ?? "GEOS Boot Disk.d64";
const d64B64 = readFileSync(d64Path).toString("base64");
const chromeBin =
  process.env.CHROME_PATH || (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);

const stock = await loadPreExportCoreBytes();
const stockB64 = stock.toString("base64");

const browser = await chromium.launch({
  headless: true,
  executablePath: chromeBin,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
const net = installGrok64CoreNetworkMonitor(page);

const toastTexts = () =>
  page.evaluate(() => Array.from(document.querySelectorAll("[data-sonner-toast]"), (t) => t.textContent?.trim() ?? ""));

async function settleHeals() {
  for (let i = 0; i < 4; i++) {
    const nav = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 40_000 }).catch(() => null);
    await waitForG64(page, 30_000);
    await page.waitForTimeout(2400);
    if (!(await nav)) return i;
  }
  return 4;
}

async function softwareInsertGeos() {
  await page.evaluate(() => window.__g64?.closeUiSheets?.());
  await openSoftware(page);
  const onDevice = page.getByRole("button", { name: /On this device/i });
  if (await onDevice.count()) {
    await onDevice.click({ timeout: 15_000 });
    await page.waitForTimeout(600);
  }
  const card = page.locator(".g64-card").filter({ hasText: d64Name }).first();
  await card.waitFor({ timeout: 15_000 });
  const tag = ((await card.locator(".g64-tag").first().textContent()) || "").trim();
  await page.locator(`button[aria-label="Insert ${d64Name}"]`).first().click({ timeout: 60_000 });
  await waitRunning(page, 90_000);
  await page.waitForTimeout(4000);
  for (let i = 0; i < 20; i++) {
    const img = await page.evaluate(async () => (await window.__g64?.attachDiskDiag?.())?.viceAttachedImage ?? "");
    if (/geos|boot/i.test(String(img))) break;
    await page.waitForTimeout(400);
  }
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.evaluate(() => window.__g64?.closeUiSheets?.());
  return tag;
}

const trace = { buildId, glueSha, d64Name, stockBytes: stock.length };

try {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await patchLocalStorage(page, { video: "pal", jiffy: false, reu: "2048kB" });
  await waitForG64(page);

  const imported = await page.evaluate(
    async ({ name, b64 }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return window.__g64?.importLibraryBytes?.(name, bin);
    },
    { name: d64Name, b64: d64B64 },
  );
  if (!imported?.id) throw new Error("library import failed");

  const seeded = await page.evaluate(
    async (b64) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return window.__g64?.qaSeedPreDiskExportCoreEverywhere?.(bin);
    },
    stockB64,
  );
  if (!seeded?.bytes) throw new Error("failed to seed a pre-disk-export core everywhere");
  trace.seeded = seeded;

  net.reset();
  await page.reload({ waitUntil: "domcontentloaded" });
  const heals = await settleHeals();
  trace.heals = heals;
  await waitForG64(page, 30_000);

  const fs = await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 180_000);
  await assertGrok64WasmCore(page, { timeoutMs: 120_000 });
  trace.power = fs;

  const tag = await softwareInsertGeos();
  await typeBasic(page, 'LOAD"$",8', { afterMs: 16_000, listAfterDollar: false });
  await page.waitForTimeout(2500);
  let screen = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  if (/BREAK/i.test(screen) || !/GEOS|DESK TOP|BLOCKS FREE/i.test(screen)) {
    await typeBasic(page, 'LOAD"$",8', { afterMs: 16_000, listAfterDollar: false });
    await page.waitForTimeout(2000);
    screen = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
    if (!/LIST|GEOS|DESK TOP|BLOCKS FREE/i.test(screen)) {
      await typeBasic(page, "LIST", { afterMs: 12_000, listAfterDollar: false });
      await page.waitForTimeout(2000);
      screen = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
    }
  } else if (!/LIST/i.test(screen)) {
    await typeBasic(page, "LIST", { afterMs: 12_000, listAfterDollar: false });
    await page.waitForTimeout(2000);
    screen = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  }

  const core = await page.evaluate(() => ({
    status: window.__g64?.grok64CoreStatus?.(),
    mismatch: window.__g64?.runningCoreMismatch?.(),
    sticky: window.__g64?.coreStaleSticky?.(),
    healPending: window.__g64?.coreHealPending?.(),
  }));
  const diag = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
  const toasts = await toastTexts();
  const netSnap = net.snapshot();
  await page.screenshot({ path: join(shotDir, "pre-export-core-heal-list.png"), fullPage: true });

  const evidence = geosFloppyEvidence({
    screen,
    session: diag?.session,
    wasmWorkDisk: diag?.wasmWorkDisk,
    viceAttachedImage: diag?.viceAttachedImage,
  });
  const exportsOk = core.status?.diskExportsPresent === true;
  const glueOk = core.status?.loadedGlueSha12 === glueSha || core.status?.coreBuildMatches === true;
  const listOk = evidence.ok || (/GEOS/i.test(screen) && !/WORK DISK/i.test(screen.slice(0, 80)));
  const toastOk = !toasts.some((t) => /old VICE core without disk attach|rc=-99|js-exports-missing/i.test(t));
  const labelOk = /1541/i.test(tag) && !/1581/i.test(tag);
  const noCdn = (netSnap.cdnVice ?? []).length === 0;
  const noHeaders = (netSnap.forbiddenHeaders ?? []).length === 0;
  const iec200 = netSnap.iec200 === true;
  const notStickyFail = core.mismatch?.mismatch !== true || exportsOk;
  const pass = glueOk && exportsOk && listOk && toastOk && labelOk && noCdn && noHeaders && iec200 && notStickyFail;

  trace.pass = pass;
  trace.tag = tag;
  trace.net = netSnap;
  trace.screen = String(screen).slice(0, 400);
  trace.toasts = toasts;
  trace.core = {
    loaded: core.status?.coreBuildIdLoaded,
    glue: core.status?.loadedGlueSha12,
    mismatch: core.mismatch,
    sticky: core.sticky,
  };
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.log(
    JSON.stringify({
      pass,
      glueOk,
      exportsOk,
      listOk,
      toastOk,
      labelOk,
      noCdn,
      noHeaders,
      iec200,
      notStickyFail,
      loaded: core.status?.coreBuildIdLoaded,
      stockBytes: stock.length,
    }),
  );
  process.exit(pass ? 0 : 1);
} catch (e) {
  trace.error = String(e?.message || e);
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.error(e);
  process.exit(1);
} finally {
  await browser.close();
}
