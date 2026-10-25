#!/usr/bin/env node
/**
 * Dirty-profile proof: Cache Storage + IDB hold a stock VICE blob, and one
 * core-refresh reload has already been spent. The app must evict those caches,
 * fetch the manifest build, and attach a disk — never toast rc=-99.
 *
 * Does not clear site data (library IDB stays). Never copies private media in.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import {
  assertGrok64WasmCore,
  grok64CoreBuildIdFromManifest,
  grok64CoreGlueShaFromManifest,
  grok64DatapathFromEnv,
  installGrok64CoreNetworkGuard,
} from "./desktop-grok64-core.mjs";
import { patchLocalStorage, powerOnDesktop, typeBasic, waitForG64, waitRunning } from "./desktop-qa-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const outDir = join(process.cwd(), "artifacts", "desktop-cache-storage-stale-core");
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

const d64Name = d64Path.split("/").pop() ?? "GEOS_2.0.d64";
const d64B64 = readFileSync(d64Path).toString("base64");
const chromeBin =
  process.env.CHROME_PATH || (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);

const browser = await chromium.launch({
  headless: true,
  executablePath: chromeBin,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await installGrok64CoreNetworkGuard(page, base);

const toastTexts = () =>
  page.evaluate(() => Array.from(document.querySelectorAll("[data-sonner-toast]"), (t) => t.textContent?.trim() ?? ""));

const trace = { buildId, glueSha, d64Name };

try {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await patchLocalStorage(page, { video: "pal", jiffy: false, reu: "2048kB" });
  await waitForG64(page);
  await page.evaluate(
    async ({ name, b64 }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await window.__g64?.importLibraryBytes?.(name, bin);
    },
    { name: d64Name, b64: d64B64 },
  );

  const seeded = await page.evaluate(async () => {
    const broken = await window.__g64?.qaSeedBrokenGrok64CoreCaches?.();
    sessionStorage.setItem("grok64.coreCacheAutoReload", "1");
    sessionStorage.removeItem("grok64.coreStaleSticky");
    return {
      broken,
      attempt: window.__g64?.coreRefreshAttempt?.(),
      lib: await window.__g64?.libraryIdbDiag?.(),
    };
  });
  trace.seeded = seeded;
  if (!seeded?.broken?.bytes) {
    throw new Error("failed to seed Cache Storage / IDB with a broken VICE blob");
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForG64(page, 30_000);

  const afterReload = await page.evaluate(async () => ({
    attempt: window.__g64?.coreRefreshAttempt?.(),
    sticky: window.__g64?.coreStaleSticky?.(),
    cacheEnv: await window.__g64?.attachDiskDiag?.({ light: true }),
    lib: await window.__g64?.libraryIdbDiag?.(),
  }));
  trace.afterReload = {
    attempt: afterReload.attempt,
    sticky: afterReload.sticky,
    libRows: afterReload.lib?.rowCount,
  };

  const nav = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 90_000 }).catch(() => null);
  await powerOnDesktop(page, base, { navigate: false });
  await nav;
  await waitForG64(page, 30_000);
  await waitRunning(page, 180_000);
  await assertGrok64WasmCore(page, { timeoutMs: 120_000 });

  const core = await page.evaluate(() => ({
    status: window.__g64?.grok64CoreStatus?.(),
    mismatch: window.__g64?.runningCoreMismatch?.(),
    attempt: window.__g64?.coreRefreshAttempt?.(),
    sticky: window.__g64?.coreStaleSticky?.(),
  }));
  trace.core = {
    diskExportsPresent: core.status?.diskExportsPresent,
    coreBuildMatches: core.status?.coreBuildMatches,
    coreBuildIdLoaded: core.status?.coreBuildIdLoaded,
    coreBuildIdExpected: core.status?.coreBuildIdExpected,
    mismatch: core.mismatch,
    attempt: core.attempt,
    sticky: core.sticky,
    blobUrl: core.status?.blobUrl,
  };

  const inserted = await page.evaluate(async (name) => {
    try {
      await window.__g64?.insertLibraryByName?.(name);
      return { ok: true };
    } catch (e) {
      return { ok: false, err: String(e?.message || e) };
    }
  }, d64Name);
  trace.inserted = inserted;
  await page.waitForTimeout(2000);
  await typeBasic(page, 'LOAD"$",8', { afterMs: 12_000 });
  await page.waitForTimeout(3000);
  await typeBasic(page, "LIST", { afterMs: 10_000 });
  await page.waitForTimeout(2000);
  const screen = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  const toasts = await toastTexts();
  await page.screenshot({ path: join(shotDir, "cache-storage-stale-core-geos-list.png"), fullPage: true });

  trace.screen = screen.slice(0, 400);
  trace.toasts = toasts;

  const glueOk = core.status?.loadedGlueSha12 === glueSha || core.status?.coreBuildMatches === true;
  const exportsOk = core.status?.diskExportsPresent === true;
  const listOk = /GEOS/i.test(screen) && !/WORK DISK/i.test(screen.slice(0, 80));
  const toastOk = !toasts.some((t) => /rc=-99|js-exports-missing/i.test(t));
  const libOk = (afterReload.lib?.rowCount ?? 0) >= 1;
  const urlOk = String(core.status?.blobUrl || "").includes(`grok64core=${buildId}`);
  const pass = glueOk && exportsOk && listOk && toastOk && libOk && urlOk && core.mismatch?.mismatch !== true;

  trace.pass = pass;
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.log(JSON.stringify({ pass, glueOk, exportsOk, listOk, toastOk, libOk, urlOk, loaded: core.status?.coreBuildIdLoaded }));
  process.exit(pass ? 0 : 1);
} catch (e) {
  trace.error = String(e?.message || e);
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.error(e);
  process.exit(1);
} finally {
  await browser.close();
}
