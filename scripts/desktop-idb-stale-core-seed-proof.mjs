#!/usr/bin/env node
/**
 * Seeds EmulatorJS-Cache with Tom-shaped stale Core metadata (grok64core, no grok64glue),
 * reloads without clearing grok64 library IDB, expects purge + fresh glue + GEOS LIST.
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  assertGrok64WasmCore,
  grok64CoreBuildIdFromManifest,
  grok64CoreGlueShaFromManifest,
  grok64DatapathFromEnv,
  installGrok64CoreNetworkGuard,
} from "./desktop-grok64-core.mjs";
import { patchLocalStorage, powerOnDesktop, typeBasic, waitForG64, waitRunning } from "./desktop-qa-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const outDir = join(process.cwd(), "artifacts", "desktop-idb-stale-core-seed");
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
    : null);

if (!grok64DatapathFromEnv() || !buildId || !glueSha || !d64Path) {
  console.log(JSON.stringify({ pass: false, skipped: true }));
  process.exit(0);
}

const d64Name = d64Path.split("/").pop() ?? "GEOS_2.0.d64";
const d64B64 = readFileSync(d64Path).toString("base64");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await installGrok64CoreNetworkGuard(page, base);

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
    const row =
      (await window.__g64?.qaSeedStaleEmulatorJsCoreCacheBlob?.()) ??
      (await window.__g64?.qaSeedStaleEmulatorJsCoreCache?.());
    const count = await window.__g64?.qaEmulatorJsCoreCacheCount?.();
    return { row, countBefore: count };
  });
  trace.seeded = seeded;
  const url = seeded?.row?.url ?? "";
  const blobPoison = seeded?.row?.bytes > 0;
  if (!url.includes("grok64core=") || (!blobPoison && url.includes("grok64glue="))) {
    throw new Error("stale seed shape wrong");
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  const afterReload = await page.evaluate(async () => ({
    coreCount: await window.__g64?.qaEmulatorJsCoreCacheCount?.(),
    lib: await window.__g64?.libraryIdbDiag?.(),
  }));
  trace.afterReload = afterReload;

  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
  await assertGrok64WasmCore(page, { timeoutMs: 120_000 });

  await page.locator('button[aria-label="Software"]').click({ timeout: 15_000 }).catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
  await page.getByRole("button", { name: new RegExp(`^(Play|Run) ${d64Name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).click({ timeout: 30_000 }).catch(async () => {
    await page.evaluate(async (name) => window.__g64?.playLibraryByName?.(name), d64Name);
  });
  await waitRunning(page, 180_000);
  await typeBasic(page, 'LOAD"$",8', { afterMs: 12_000 });
  await page.waitForTimeout(3000);
  await typeBasic(page, "LIST", { afterMs: 10_000 });
  await page.waitForTimeout(2000);
  const screen = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  const diag = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
  await page.screenshot({ path: join(shotDir, "idb-stale-seed-geos-list.png"), fullPage: true });

  trace.screen = screen.slice(0, 400);
  trace.diag = {
    loadedGlueSha12: diag?.loadedGlueSha12,
    coreBuildMatches: diag?.coreBuildMatches,
    diskExportsPresent: diag?.diskExportsPresent,
    blobUrl: diag?.grok64Core?.blobUrl,
  };

  const glueOk = diag?.loadedGlueSha12 === glueSha && diag?.loadedGlueHasDiskExports === true;
  const listOk = /GEOS/i.test(screen) && !/WORK DISK/i.test(screen.slice(0, 80));
  const libOk = (afterReload.lib?.rowCount ?? 0) >= 1;
  const pass = glueOk && diag?.coreBuildMatches === true && diag?.diskExportsPresent === true && libOk && listOk;
  trace.pass = pass;
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.log(JSON.stringify({ pass, glueOk, listOk, libOk, loaded: diag?.loadedGlueSha12 }));
  process.exit(pass ? 0 : 1);
} catch (e) {
  trace.error = String(e?.message || e);
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.error(e);
  process.exit(1);
} finally {
  await browser.close();
}
