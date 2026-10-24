#!/usr/bin/env node
/**
 * Tom-shaped profile: stock vice_x64sc-wasm.data in EmulatorJS-core (legacy CDN store),
 * not EmulatorJS-Cache. Expect Grok64 IEC glue after power-on without touching grok64 library IDB.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertGrok64WasmCore,
  grok64CoreGlueShaFromManifest,
  grok64DatapathFromEnv,
  installGrok64CoreNetworkGuard,
} from "./desktop-grok64-core.mjs";
import { patchLocalStorage, powerOnDesktop, waitForG64, waitRunning } from "./desktop-qa-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const outDir = join(process.cwd(), "artifacts", "desktop-emulatorjs-legacy-core");
mkdirSync(outDir, { recursive: true });

const glueSha = grok64CoreGlueShaFromManifest();

if (!grok64DatapathFromEnv() || !glueSha) {
  console.log(JSON.stringify({ pass: false, skipped: true }));
  process.exit(0);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await installGrok64CoreNetworkGuard(page, base);

const trace = { glueSha };

try {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await patchLocalStorage(page, { video: "pal", jiffy: false, reu: "2048kB" });
  await waitForG64(page);
  const seeded = await page.evaluate(async () => {
    const row = await window.__g64?.qaSeedEmulatorJsLegacyCore?.();
    const legacy = await window.__g64?.attachDiskDiag?.().then((d) => d?.legacyCoreIdb);
    return { row, legacyBefore: legacy };
  });
  trace.seeded = seeded;
  if (!seeded?.row?.key?.includes("vice_x64sc-wasm.data")) {
    throw new Error("legacy core seed failed");
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  const afterReload = await page.evaluate(async () => ({
    legacy: (await window.__g64?.attachDiskDiag?.())?.legacyCoreIdb,
    lib: await window.__g64?.libraryIdbDiag?.(),
  }));
  trace.afterReload = afterReload;

  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
  const core = await assertGrok64WasmCore(page, { timeoutMs: 120_000 });
  const diag = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
  trace.core = core;
  trace.diag = {
    loadedGlueSha12: diag?.loadedGlueSha12,
    loadedGlueHasDiskExports: diag?.loadedGlueHasDiskExports,
    loads: diag?.grok64Core?.loads,
    legacyCoreIdb: diag?.legacyCoreIdb,
    dataFetches: diag?.cacheEnvironment?.dataFetches?.slice(-5),
  };

  const glueOk = diag?.loadedGlueSha12 === glueSha && diag?.loadedGlueHasDiskExports === true;
  const loadsOk = Array.isArray(diag?.grok64Core?.loads) && diag.grok64Core.loads.length > 0;
  const legacyViceGone =
    !diag?.legacyCoreIdb?.viceRows?.length ||
    diag.legacyCoreIdb.viceRows.every((r) => r.byteLength == null);
  const pass = glueOk && loadsOk && diag?.diskExportsPresent === true && diag?.coreBuildMatches === true;
  trace.pass = pass;
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.log(JSON.stringify({ pass, glueOk, loadsOk, legacyViceGone, loaded: diag?.loadedGlueSha12 }));
  process.exit(pass ? 0 : 1);
} catch (e) {
  trace.error = String(e?.message || e);
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.error(e);
  process.exit(1);
} finally {
  await browser.close();
}
