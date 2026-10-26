#!/usr/bin/env node
/**
 * Headed Chromium persistent profile: simulate a long-lived main-branch CDN session
 * (cached EmulatorJS + stale IDB cores), then this build with no storage wipe.
 * Power → Software Insert d64 → LIST with zero cdn.emulatorjs.org requests.
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const outDir = join(process.cwd(), "artifacts", "desktop-headed-vite-main-profile");
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
const trace = { buildId, glueSha, d64Name, headed, base, profileDir };

const context = await chromium.launchPersistentContext(profileDir, {
  headless: !headed,
  executablePath: chromeBin,
  viewport: { width: 1280, height: 800 },
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = context.pages()[0] || (await context.newPage());
const net = installGrok64CoreNetworkMonitor(page);

async function simulateMainBranchCdnVisits() {
  const cdnScripts = [
    "https://cdn.emulatorjs.org/stable/data/src/emulator.js",
    "https://cdn.emulatorjs.org/stable/data/src/GameManager.js",
    "https://cdn.emulatorjs.org/stable/data/emulator.css",
  ];
  for (let round = 0; round < 3; round++) {
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await waitForG64(page, 20_000).catch(() => undefined);
    await page.evaluate(async (urls) => {
      for (const u of urls) {
        try {
          await fetch(u, { mode: "cors" });
        } catch {
          /* cache may still record attempt */
        }
      }
    }, cdnScripts);
    await page.waitForTimeout(400);
  }
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await waitForG64(page, 20_000);
  await page.evaluate(async () => {
    await window.__g64?.qaSeedBrokenGrok64CoreCaches?.();
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
  await simulateMainBranchCdnVisits();
  await page.reload({ waitUntil: "domcontentloaded" });
  await patchLocalStorage(page, { video: "pal", jiffy: false, reu: "2048kB" });
  await waitForG64(page);
  await page.evaluate(
    async ({ name, b64 }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await window.__g64?.importLibraryBytes?.(name, bin);
    },
    { name: d64Name, b64: d64B64 },
  );

  net.reset();
  const powered = await powerOnDesktop(page, base, { navigate: false });
  trace.power = powered;
  await waitRunning(page, 240_000);

  const core = await page.evaluate(() => window.__g64?.grok64CoreStatus?.());
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
  const insertLabel = `Insert ${d64Name}`;
  await page.locator(`button[aria-label="${insertLabel}"]`).first().click({ timeout: 90_000 });
  await waitRunning(page, 120_000);
  await page.waitForTimeout(2500);
  await waitReadyScreen();
  await typeBasic(page, "LIST", { afterMs: 12_000, listAfterDollar: false });
  const listScreen = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  trace.listScreen = listScreen.slice(0, 300);

  const toasts = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-sonner-toast]"), (t) => t.textContent?.trim() ?? ""),
  );
  const netSnap = net.snapshot();
  trace.net = netSnap;

  const loaderOk =
    Array.isArray(core?.ejsLoader?.scriptSources) &&
    core.ejsLoader.scriptSources.length > 0 &&
    !core.ejsLoader.scriptSources.some((u) => /cdn\.emulatorjs\.org/i.test(String(u)));
  const glueOk = core?.loadedGlueSha12 === glueSha || core?.coreBuildMatches === true;
  const exportsOk = core?.diskExportsPresent === true;
  const listOk = /"?\w|BLOCKS FREE|PRG|SEQ|GEOS/i.test(listScreen);
  const toastOk = !toasts.some((t) => /old VICE core without disk attach|stale-no-disk-exports|rc=-99/i.test(t));
  const noCdn = (netSnap.cdnAll ?? []).length === 0;
  const pass = powered && loaderOk && glueOk && exportsOk && listOk && toastOk && noCdn;

  trace.pass = pass;
  trace.checks = { powered, loaderOk, glueOk, exportsOk, listOk, toastOk, noCdn };

  await page.screenshot({ path: join(shotDir, "headed-vite-main-profile-list.png"), fullPage: true });
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.log(JSON.stringify({ pass, checks: trace.checks, buildId: core?.coreBuildIdLoaded }));
  process.exit(pass ? 0 : 1);
} catch (e) {
  trace.error = e instanceof Error ? e.message : String(e);
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.log(JSON.stringify({ pass: false, error: trace.error }));
  process.exit(1);
} finally {
  await context.close();
}
