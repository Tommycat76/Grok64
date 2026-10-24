#!/usr/bin/env node
/**
 * Proves EmulatorJS core cache-bust: seed IDB with legacy (unbusted) URL, then load current build
 * without clearing IndexedDB — new ?grok64core= URL must load exports + GEOS LIST.
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  assertGrok64WasmCore,
  grok64CoreBlobUrl,
  grok64CoreBuildIdFromManifest,
  grok64DatapathFromEnv,
  installGrok64CoreNetworkGuard,
  readGrok64CoreStatus,
} from "./desktop-grok64-core.mjs";
import { patchLocalStorage, powerOnDesktop, typeBasic, waitRunning, waitForG64 } from "./desktop-qa-lib.mjs";

async function listText(page) {
  await typeBasic(page, 'LOAD"$",8', { afterMs: 12_000 });
  await page.waitForTimeout(4000);
  await typeBasic(page, "LIST", { afterMs: 10_000 });
  await page.waitForTimeout(2500);
  return await page.evaluate(() => window.__g64?.screenText?.() || "");
}

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const outDir = join(process.cwd(), "artifacts", "desktop-core-cache-bust");
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

const legacyUrl = grok64CoreBlobUrl(base, { cacheBust: false });
const bustedUrl = grok64CoreBlobUrl(base, { cacheBust: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
await installGrok64CoreNetworkGuard(page, base);

const trace = { buildId, legacyUrl, bustedUrl, steps: [] };

try {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await patchLocalStorage(page, { video: "pal", jiffy: false, reu: "2048kB" });
  await page.evaluate(() => window.localStorage.setItem("grok64.testCoreBuildId", "legacy"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await powerOnDesktop(page, base, { navigate: false });
  await assertGrok64WasmCore(page, { timeoutMs: 120_000 });
  const afterLegacy = await readGrok64CoreStatus(page);
  trace.steps.push({ phase: "legacy-url", core: afterLegacy });

  await page.evaluate(() => window.localStorage.removeItem("grok64.testCoreBuildId"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.evaluate(() => window.__g64?.powerOff?.());
  await page.waitForTimeout(800);
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
  const afterBust = await assertGrok64WasmCore(page, { timeoutMs: 120_000 });
  trace.steps.push({ phase: "busted-url", core: afterBust });

  const loads = await page.evaluate(() => window.__GROK64_CORE_LOADS__ ?? []);
  const bustUrlOk =
    afterBust.coreUrlBuildId === buildId &&
    String(afterBust.blobUrl || "").includes(`grok64core=${buildId}`) &&
    String(afterBust.blobUrl || "").includes("grok64glue=");
  const legacyUrlOk = afterLegacy.coreUrlBuildId == null && !String(afterLegacy.blobUrl || "").includes("grok64core=");
  trace.loads = loads;
  trace.bustUrlOk = bustUrlOk;
  trace.legacyUrlOk = legacyUrlOk;

  await page.locator('button[aria-label="Software"]').click({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /On this device/i }).click();
  await page.waitForTimeout(300);
  await page.locator('input[type="file"]').setInputFiles(d64Path);
  await page.waitForTimeout(1500);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('button[aria-label="Software"]').click({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /On this device/i }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /^(Play|Run) GEOS_2\.0\.d64$/ }).click({ timeout: 30_000 });
  await waitRunning(page, 180_000);
  await waitForG64(page);
  const screen = await listText(page);
  const diag = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
  trace.screen = screen.slice(0, 400);
  trace.diag = diag;

  const listOk =
    !/FILE NOT FOUND|DEVICE NOT PRESENT/i.test(screen) &&
    (/GEOS/i.test(screen) || /47454f53/i.test(diag?.session?.dir18s1Hex ?? ""));
  const loadedOk =
    afterBust.coreBuildIdLoaded === buildId ||
    (afterBust.coreBuildMatches === true && afterBust.loadedGlueHasDiskExports === true);
  const pass =
    afterBust.coreBuildId === buildId &&
    afterBust.coreBuildIdExpected === buildId &&
    loadedOk &&
    afterBust.diskExportsPresent === true &&
    bustUrlOk &&
    legacyUrlOk &&
    listOk &&
    diag?.diskExportsPresent === true &&
    diag?.coreBuildMatches !== false;

  trace.pass = pass;
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.log(
    JSON.stringify({ pass, buildId, bustUrlOk, legacyUrlOk, listOk, coreBuildId: afterBust.coreBuildId }),
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
