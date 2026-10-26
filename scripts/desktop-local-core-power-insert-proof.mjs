#!/usr/bin/env node
/**
 * Dirty-profile Power must boot from the local IEC blob — never cdn.emulatorjs.org
 * vice cores, never Cache-Control/Pragma on those requests. Two passes on the
 * same profile: without a stale EmulatorJS-core row, then with one. Real Power,
 * Software Insert of the GEOS disk, then LIST.
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
const outDir = join(process.cwd(), "artifacts", "desktop-local-core-power-insert");
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

const d64Name = d64Path.split("/").pop() ?? "GEOS Boot Disk.d64";
const d64B64 = readFileSync(d64Path).toString("base64");
const chromeBin =
  process.env.CHROME_PATH || (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);

const browser = await chromium.launch({
  headless: true,
  executablePath: chromeBin,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
const net = installGrok64CoreNetworkMonitor(page);

const toastTexts = () =>
  page.evaluate(() => Array.from(document.querySelectorAll("[data-sonner-toast]"), (t) => t.textContent?.trim() ?? ""));

async function stillLoading() {
  return page.evaluate(() => {
    const t = document.body?.innerText || "";
    return /still loading/i.test(t) && !/READY/i.test(t);
  });
}

async function settleHeals() {
  for (let i = 0; i < 5; i++) {
    const nav = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 50_000 }).catch(() => null);
    await waitForG64(page, 30_000);
    await page.waitForTimeout(2800);
    if (!(await nav)) return i;
  }
  return 5;
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
  const insertLabel = `Insert ${d64Name}`;
  await page.locator(`button[aria-label="${insertLabel}"]`).first().click({ timeout: 60_000 });
  await waitRunning(page, 90_000);
  await page.waitForTimeout(2500);
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.evaluate(() => window.__g64?.closeUiSheets?.());
  return tag;
}

async function waitReadyScreen() {
  for (let i = 0; i < 50; i++) {
    const t = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
    if (/READY\./i.test(t) && !/SEARCHING|LOADING/i.test(t)) return t;
    await page.waitForTimeout(400);
  }
  return page.evaluate(() => window.__g64?.screenText?.() ?? "");
}

async function listGeos() {
  await waitReadyScreen();
  await page.waitForTimeout(4000);
  await page
    .locator("#grok64-player canvas, .g64-crt canvas")
    .first()
    .click({ timeout: 10_000, force: true })
    .catch(() => undefined);
  let after = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    await typeBasic(page, 'LOAD"$",8', { afterMs: 16_000, listAfterDollar: false });
    await page.waitForTimeout(2500);
    after = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
    if (/BREAK/i.test(after)) {
      await waitReadyScreen();
      await page.waitForTimeout(3000);
      continue;
    }
    if (!/LIST|GEOS|DESK TOP|BLOCKS FREE/i.test(after)) {
      await typeBasic(page, "LIST", { afterMs: 12_000, listAfterDollar: false });
      await page.waitForTimeout(2500);
      after = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
    }
    if (/GEOS|DESK TOP|BLOCKS FREE/i.test(after)) break;
  }
  const diag = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
  const toasts = await toastTexts();
  const core = await page.evaluate(() => ({
    status: window.__g64?.grok64CoreStatus?.(),
    mismatch: window.__g64?.runningCoreMismatch?.(),
  }));
  const evidence = geosFloppyEvidence({
    screen: after,
    session: diag?.session,
    wasmWorkDisk: diag?.wasmWorkDisk,
    viceAttachedImage: diag?.viceAttachedImage,
  });
  return { screen: after, diag, toasts, core, evidence };
}

async function runPass(label, { seedStale }) {
  net.reset();
  await waitForG64(page, 30_000);
  if (seedStale) {
    const seeded = await page.evaluate(async () => {
      const broken = await window.__g64?.qaSeedBrokenGrok64CoreCaches?.();
      sessionStorage.removeItem("g64-crash-play");
      sessionStorage.removeItem("g64-live-play");
      sessionStorage.removeItem("grok64.coreHealPending");
      return { broken, lib: await window.__g64?.libraryIdbDiag?.() };
    });
    if (!seeded?.broken?.bytes) throw new Error(`${label}: failed to seed a stale VICE blob`);
    await page.reload({ waitUntil: "domcontentloaded" });
    const heals = await settleHeals();
    const snap = { seeded, heals };
    await waitForG64(page, 30_000);
    const powered = await page.evaluate(() => Boolean(window.__g64?.powered?.() || window.__g64?.hasFs?.()));
    if (!powered) {
      const fs = await powerOnDesktop(page, base, { navigate: false });
      snap.power = fs;
    }
    await waitRunning(page, 180_000);
    snap.stillLoading = await stillLoading();
    await assertGrok64WasmCore(page, { timeoutMs: 120_000 });
    const tag = await softwareInsertGeos();
    const listed = await listGeos();
    const netSnap = net.snapshot();
    return { label, seedStale, tag, net: netSnap, ...listed, extra: snap };
  }

  await page.evaluate(async () => {
    await window.__g64?.qaForceFreshGrok64Core?.();
    sessionStorage.removeItem("g64-crash-play");
    sessionStorage.removeItem("g64-live-play");
    sessionStorage.removeItem("grok64.coreHealPending");
  });
  const fs = await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 180_000);
  const loading = await stillLoading();
  await assertGrok64WasmCore(page, { timeoutMs: 120_000 });
  const tag = await softwareInsertGeos();
  const listed = await listGeos();
  return {
    label,
    seedStale,
    tag,
    net: net.snapshot(),
    extra: { power: fs, stillLoading: loading },
    ...listed,
  };
}

function passOk(result) {
  const exportsOk = result.core?.status?.diskExportsPresent === true;
  const glueOk = result.core?.status?.loadedGlueSha12 === glueSha || result.core?.status?.coreBuildMatches === true;
  const listOk =
    result.evidence?.ok || (/GEOS/i.test(result.screen) && !/WORK DISK/i.test(String(result.screen).slice(0, 80)));
  const toastOk = !(result.toasts ?? []).some((t) => /old VICE core without disk attach|rc=-99|js-exports-missing/i.test(t));
  const labelOk = /1541/i.test(result.tag) && !/1581/i.test(result.tag);
  const noCdn = (result.net?.cdnVice ?? []).length === 0;
  const noHeaders = (result.net?.forbiddenHeaders ?? []).length === 0;
  const iec200 = result.net?.iec200 === true;
  const notStuck = result.extra?.stillLoading !== true;
  const ok = glueOk && exportsOk && listOk && toastOk && labelOk && noCdn && noHeaders && iec200 && notStuck;
  return {
    ok,
    checks: { glueOk, exportsOk, listOk, toastOk, labelOk, noCdn, noHeaders, iec200, notStuck },
  };
}

const trace = { buildId, glueSha, d64Name };

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
  trace.imported = { id: imported.id, name: d64Name };

  const clean = await runPass("no-stale-idb", { seedStale: false });
  const cleanScore = passOk(clean);
  await page.screenshot({ path: join(shotDir, "local-core-power-insert-clean.png"), fullPage: true });
  trace.clean = {
    checks: cleanScore.checks,
    tag: clean.tag,
    net: clean.net,
    screen: String(clean.screen ?? "").slice(0, 400),
    toasts: clean.toasts,
    extra: clean.extra,
    loaded: clean.core?.status?.coreBuildIdLoaded,
  };

  await page.evaluate(() => window.__g64?.powerOff?.());
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForG64(page);

  const stale = await runPass("stale-idb", { seedStale: true });
  const staleScore = passOk(stale);
  await page.screenshot({ path: join(shotDir, "local-core-power-insert-stale.png"), fullPage: true });
  trace.stale = {
    checks: staleScore.checks,
    tag: stale.tag,
    net: stale.net,
    screen: String(stale.screen ?? "").slice(0, 400),
    toasts: stale.toasts,
    extra: stale.extra,
    loaded: stale.core?.status?.coreBuildIdLoaded,
  };

  const pass = cleanScore.ok && staleScore.ok;
  trace.pass = pass;
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.log(
    JSON.stringify({
      pass,
      clean: cleanScore.checks,
      stale: staleScore.checks,
      loadedClean: clean.core?.status?.coreBuildIdLoaded,
      loadedStale: stale.core?.status?.coreBuildIdLoaded,
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
