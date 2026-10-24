#!/usr/bin/env node
/**
 * Regression: user library (`grok64` IDB) survives EmulatorJS core manifest / cache hygiene.
 * Seeds an imported disk, simulates manifest build-id bump (purge stale core rows only), reloads.
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  grok64CoreBuildIdFromManifest,
  grok64DatapathFromEnv,
  installGrok64CoreNetworkGuard,
} from "./desktop-grok64-core.mjs";
import { patchLocalStorage, powerOnDesktop, waitRunning, waitForG64 } from "./desktop-qa-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const outDir = join(process.cwd(), "artifacts", "desktop-library-survives-core-bump");
mkdirSync(outDir, { recursive: true });

spawnSync(process.execPath, ["scripts/prepare-floppy-fixtures.mjs"], { stdio: "inherit" });

const buildId = grok64CoreBuildIdFromManifest();
const d64Path =
  process.env.GROK64_GEOS_D64_PATH ||
  (existsSync(join(process.cwd(), "fixtures", "geos", "GEOS_2.0.d64"))
    ? join(process.cwd(), "fixtures", "geos", "GEOS_2.0.d64")
    : null);

if (!grok64DatapathFromEnv() || !buildId || !d64Path) {
  console.log(JSON.stringify({ pass: false, skipped: true, reason: "missing env, manifest, or GEOS d64" }));
  process.exit(0);
}

const d64Name = d64Path.split("/").pop() ?? "GEOS_2.0.d64";
const d64B64 = readFileSync(d64Path).toString("base64");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
await installGrok64CoreNetworkGuard(page, base);

const trace = { buildId, d64Name, steps: [] };

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
  await page.waitForTimeout(500);

  const afterImport = await page.evaluate(async () => ({
    count: (await window.__g64?.listLibraryItems?.())?.length ?? 0,
    names: (await window.__g64?.listLibraryItems?.())?.map((i) => i.name) ?? [],
    lib: await window.__g64?.attachDiskDiag?.().then((d) => d?.libraryIdb),
  }));
  trace.steps.push({ phase: "after-import", ...afterImport });

  await page.evaluate(() => {
    window.localStorage.setItem("grok64.ejsCoreManifestBuildId", "deadbeef0001");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  const afterBump = await page.evaluate(async () => ({
    count: (await window.__g64?.listLibraryItems?.())?.length ?? 0,
    names: (await window.__g64?.listLibraryItems?.())?.map((i) => i.name) ?? [],
    lib: await window.__g64?.attachDiskDiag?.().then((d) => d?.libraryIdb),
  }));
  trace.steps.push({ phase: "after-manifest-bump-reload", ...afterBump });

  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
  const screen = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  const core = await page.evaluate(() => window.__g64?.grok64CoreStatus?.() ?? null);

  trace.screen = screen.slice(0, 200);
  trace.core = core;

  const importOk = afterImport.count >= 1 && afterImport.names.some((n) => /GEOS/i.test(n));
  const surviveOk =
    afterBump.count >= afterImport.count &&
    afterBump.names.some((n) => n === d64Name || /GEOS/i.test(n));
  const bootOk = /READY/i.test(screen);
  const pass = importOk && surviveOk && bootOk && afterBump.lib?.rowCount >= 1;

  trace.pass = pass;
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.log(JSON.stringify({ pass, importOk, surviveOk, bootOk, afterImport, afterBump }));
  process.exit(pass ? 0 : 1);
} catch (e) {
  trace.error = String(e?.message || e);
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.error(e);
  process.exit(1);
} finally {
  await browser.close();
}
