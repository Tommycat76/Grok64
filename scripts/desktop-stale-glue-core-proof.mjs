#!/usr/bin/env node
/**
 * Simulates an upgraded profile: stale manifest LS + EmulatorJS core row without grok64glue,
 * then expects fresh glue (disk exports) after reload without clearing grok64 library IDB.
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertGrok64WasmCore,
  grok64CoreBuildIdFromManifest,
  grok64CoreGlueShaFromManifest,
  grok64DatapathFromEnv,
  installGrok64CoreNetworkGuard,
} from "./desktop-grok64-core.mjs";
import { patchLocalStorage, powerOnDesktop, waitRunning } from "./desktop-qa-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const outDir = join(process.cwd(), "artifacts", "desktop-stale-glue-core");
mkdirSync(outDir, { recursive: true });

const buildId = grok64CoreBuildIdFromManifest();
const glueSha = grok64CoreGlueShaFromManifest();

if (!grok64DatapathFromEnv() || !buildId || !glueSha) {
  console.log(JSON.stringify({ pass: false, skipped: true }));
  process.exit(0);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newContext().then((c) => c.newPage());
await installGrok64CoreNetworkGuard(page, base);

const trace = { buildId, glueSha };

try {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await patchLocalStorage(page, { video: "pal", jiffy: false, reu: "2048kB" });
  await page.evaluate(() => {
    window.localStorage.setItem("grok64.ejsCoreManifestBuildId", "stale-glue-seed-deadbeef");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
  const core = await assertGrok64WasmCore(page, { timeoutMs: 120_000 });
  const diag = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
  trace.core = core;
  trace.diag = {
    coreBuildIdLoaded: diag?.coreBuildIdLoaded,
    coreBuildMatches: diag?.coreBuildMatches,
    loadedGlueSha12: diag?.loadedGlueSha12,
    loadedGlueHasDiskExports: diag?.loadedGlueHasDiskExports,
    blobUrl: diag?.grok64Core?.blobUrl,
  };
  const urlOk = String(diag?.grok64Core?.blobUrl || "").includes(`grok64glue=${glueSha}`);
  const glueOk = diag?.loadedGlueSha12 === glueSha && diag?.loadedGlueHasDiskExports === true;
  const pass = urlOk && glueOk && diag?.coreBuildMatches === true && diag?.diskExportsPresent === true;
  trace.pass = pass;
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.log(JSON.stringify({ pass, urlOk, glueOk, loaded: diag?.loadedGlueSha12 }));
  process.exit(pass ? 0 : 1);
} catch (e) {
  trace.error = String(e?.message || e);
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.error(e);
  process.exit(1);
} finally {
  await browser.close();
}
