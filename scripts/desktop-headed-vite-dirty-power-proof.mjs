#!/usr/bin/env node
/**
 * Headed Chromium + persistent profile: dirty EmulatorJS-core seed, hard reload,
 * real Power click, READY, Software Insert + LIST. Vite dev on :8080 only.
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  grok64CoreBuildIdFromManifest,
  grok64CoreGlueShaFromManifest,
  grok64DatapathFromEnv,
  installGrok64CoreNetworkMonitor,
} from "./desktop-grok64-core.mjs";
import {
  openSoftware,
  patchLocalStorage,
  powerOnDesktop,
  typeBasic,
  waitForG64,
  waitRunning,
} from "./desktop-qa-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const outDir = join(process.cwd(), "artifacts", "desktop-headed-vite-dirty-power");
const profileDir = join(outDir, "chrome-profile");
const shotDir = join(process.cwd(), "screenshots");
mkdirSync(outDir, { recursive: true });
mkdirSync(shotDir, { recursive: true });

const buildId = grok64CoreBuildIdFromManifest();
const glueSha = grok64CoreGlueShaFromManifest();
const d64Path =
  process.env.GROK64_GEOS_D64_PATH ||
  (existsSync(join(process.cwd(), "fixtures", "geos", "GEOS_2.0.d64"))
    ? join(process.cwd(), "fixtures", "geos", "GEOS_2.0.d64")
    : join(process.cwd(), "public", "software", "grok64-workbench.d64"));

if (!grok64DatapathFromEnv() || !buildId || !glueSha || !existsSync(d64Path)) {
  console.log(JSON.stringify({ pass: false, skipped: true, reason: "env/manifest/d64" }));
  process.exit(0);
}

spawnSync(process.execPath, ["scripts/prepare-floppy-fixtures.mjs"], { stdio: "inherit" });

const d64Name = d64Path.split("/").pop() ?? "disk.d64";
const d64B64 = readFileSync(d64Path).toString("base64");
const chromeBin =
  process.env.CHROME_PATH || (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);

const headed = process.env.GROK64_HEADED !== "0";
const trace = { buildId, glueSha, d64Name, headed, base };

const context = await chromium.launchPersistentContext(profileDir, {
  headless: !headed,
  executablePath: chromeBin,
  viewport: { width: 1280, height: 800 },
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = context.pages()[0] || (await context.newPage());
const net = installGrok64CoreNetworkMonitor(page);

async function stillLoading() {
  return page.evaluate(() => {
    const t = document.body?.innerText || "";
    return /still loading/i.test(t) && !/READY/i.test(t);
  });
}

async function waitReadyScreen() {
  for (let i = 0; i < 80; i++) {
    const t = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
    if (/READY\./i.test(t) && !/SEARCHING|LOADING/i.test(t)) return t;
    await page.waitForTimeout(400);
  }
  return page.evaluate(() => window.__g64?.screenText?.() ?? "");
}

try {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90_000 });
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
    sessionStorage.setItem("grok64.coreHealPending", "1");
    sessionStorage.setItem("grok64.coreCacheAutoReload", "2");
    sessionStorage.setItem("grok64.coreStaleSticky", "1");
    return broken;
  });
  trace.seeded = seeded;

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await waitForG64(page, 30_000);

  net.reset();
  const powered = await powerOnDesktop(page, base, { navigate: false });
  trace.power = powered;
  await waitRunning(page, 240_000);
  trace.stillLoading = await stillLoading();

  const core = await page.evaluate(() => ({
    status: window.__g64?.grok64CoreStatus?.(),
    loads: window.__g64?.grok64CoreStatus?.()?.loads,
  }));
  trace.core = core;

  const ready = await waitReadyScreen();
  trace.readyScreen = ready.slice(0, 200);

  await page.evaluate(() => window.__g64?.closeUiSheets?.());
  await openSoftware(page);
  const onDevice = page.getByRole("button", { name: /On this device/i });
  if (await onDevice.count()) {
    await onDevice.click({ timeout: 15_000 });
    await page.waitForTimeout(600);
  }
  const card = page.locator(".g64-card").filter({ hasText: d64Name }).first();
  await card.waitFor({ timeout: 20_000 });
  const insertLabel = `Insert ${d64Name}`;
  await page.locator(`button[aria-label="${insertLabel}"]`).first().click({ timeout: 90_000 });
  await waitRunning(page, 120_000);
  await page.waitForTimeout(3000);

  await waitReadyScreen();
  await typeBasic(page, "LIST", { afterMs: 12_000, listAfterDollar: false });
  const listScreen = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  trace.listScreen = listScreen.slice(0, 300);

  const toasts = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-sonner-toast]"), (t) => t.textContent?.trim() ?? ""),
  );
  const netSnap = net.snapshot();
  trace.net = netSnap;

  const glueOk = core.status?.loadedGlueSha12 === glueSha || core.status?.coreBuildMatches === true;
  const exportsOk = core.status?.diskExportsPresent === true;
  const readyOk = /READY/i.test(ready) && !trace.stillLoading;
  const listOk = /"?\w|BLOCKS FREE|PRG|SEQ|GEOS/i.test(listScreen);
  const toastOk = !toasts.some((t) => /old VICE core without disk attach|rc=-99|js-exports-missing/i.test(t));
  const noCdn = (netSnap.cdnVice ?? []).length === 0;
  const noHeaders = (netSnap.forbiddenHeaders ?? []).length === 0;
  const iec200 = netSnap.iec200 === true;
  const pass = powered && glueOk && exportsOk && readyOk && listOk && toastOk && noCdn && noHeaders && iec200;

  trace.pass = pass;
  trace.checks = { powered, glueOk, exportsOk, readyOk, listOk, toastOk, noCdn, noHeaders, iec200 };

  await page.screenshot({ path: join(shotDir, "headed-vite-dirty-power-list.png"), fullPage: true });
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.log(JSON.stringify({ pass, checks: trace.checks, buildId: core.status?.coreBuildIdLoaded }));
  process.exit(pass ? 0 : 1);
} catch (e) {
  trace.error = e instanceof Error ? e.message : String(e);
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.log(JSON.stringify({ pass: false, error: trace.error }));
  process.exit(1);
} finally {
  await context.close();
}
