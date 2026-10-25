#!/usr/bin/env node
/**
 * Long-lived dirty profile: old EmulatorJS-core row (no ?EJS_KEYS!), Cache Storage,
 * a saved running session, and a library. Must self-heal on real Software → Insert
 * without clearing site data. After a heal reload the splash stays (no READY resume
 * on the old core).
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
const outDir = join(process.cwd(), "artifacts", "desktop-stale-core-selfheal");
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
await installGrok64CoreNetworkGuard(page, base);

const toastTexts = () =>
  page.evaluate(() => Array.from(document.querySelectorAll("[data-sonner-toast]"), (t) => t.textContent?.trim() ?? ""));

async function settleHeals() {
  for (let i = 0; i < 5; i++) {
    const nav = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 50_000 }).catch(() => null);
    await waitForG64(page, 30_000);
    await page.waitForTimeout(2800);
    if (!(await nav)) return i;
  }
  return 5;
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

  const seeded = await page.evaluate(
    async ({ name, libraryId }) => {
      const broken = await window.__g64?.qaSeedBrokenGrok64CoreCaches?.();
      sessionStorage.setItem("grok64.coreCacheAutoReload", "2");
      sessionStorage.setItem("grok64.coreStaleSticky", "1");
      sessionStorage.removeItem("grok64.coreLastFetchBytes");
      sessionStorage.removeItem("grok64.coreHealPending");
      sessionStorage.setItem("g64-live-play", name);
      sessionStorage.setItem(
        "g64-crash-play",
        JSON.stringify({ title: name, filename: name, libraryId, savedAt: Date.now() }),
      );
      const legacy = await window.__g64?.attachDiskDiag?.().then((d) => d?.legacyCoreIdb);
      return {
        broken,
        attempt: window.__g64?.coreRefreshAttempt?.(),
        sticky: window.__g64?.coreStaleSticky?.(),
        legacyVice: legacy?.viceRows ?? [],
        lib: await window.__g64?.libraryIdbDiag?.(),
      };
    },
    { name: d64Name, libraryId: imported.id },
  );
  trace.seeded = seeded;
  if (!seeded?.broken?.bytes) throw new Error("failed to seed a broken VICE blob");

  await page.reload({ waitUntil: "domcontentloaded" });
  const heals = await settleHeals();
  trace.heals = heals;

  const afterHeal = await page.evaluate(async () => ({
    attempt: window.__g64?.coreRefreshAttempt?.(),
    sticky: window.__g64?.coreStaleSticky?.(),
    healPending: window.__g64?.coreHealPending?.(),
    powered: window.__g64?.powered?.(),
    running: window.__g64?.running?.(),
    livePlay: sessionStorage.getItem("g64-live-play"),
    crashPlay: sessionStorage.getItem("g64-crash-play"),
    lib: await window.__g64?.libraryIdbDiag?.(),
    splash: Boolean(document.querySelector(".g64-splash[data-on='true']")),
  }));
  trace.afterHeal = afterHeal;

  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 180_000);
  await assertGrok64WasmCore(page, { timeoutMs: 120_000 });

  await openSoftware(page);
  await page.getByRole("button", { name: /On this device/i }).click({ timeout: 15_000 });
  await page.waitForTimeout(600);

  const card = page.locator(".g64-card").filter({ hasText: d64Name }).first();
  await card.waitFor({ timeout: 15_000 });
  const tag = ((await card.locator(".g64-tag").first().textContent()) || "").trim();
  trace.softwareTag = tag;
  const labelOk = /1541/i.test(tag) && !/1581/i.test(tag);

  const insertLabel = `Insert ${d64Name}`;
  await page.locator(`button[aria-label="${insertLabel}"]`).first().click({ timeout: 60_000 });
  await waitRunning(page, 90_000);
  await page.waitForTimeout(2500);

  const core = await page.evaluate(() => ({
    status: window.__g64?.grok64CoreStatus?.(),
    mismatch: window.__g64?.runningCoreMismatch?.(),
    attempt: window.__g64?.coreRefreshAttempt?.(),
    sticky: window.__g64?.coreStaleSticky?.(),
    healPending: window.__g64?.coreHealPending?.(),
  }));
  trace.core = {
    diskExportsPresent: core.status?.diskExportsPresent,
    coreBuildMatches: core.status?.coreBuildMatches,
    coreBuildIdLoaded: core.status?.coreBuildIdLoaded,
    mismatch: core.mismatch,
    attempt: core.attempt,
    sticky: core.sticky,
    healPending: core.healPending,
    blobUrl: core.status?.blobUrl,
  };

  await typeBasic(page, 'LOAD"$",8', { afterMs: 12_000 });
  await page.waitForTimeout(3000);
  await typeBasic(page, "LIST", { afterMs: 10_000 });
  await page.waitForTimeout(2000);
  const screen = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  const diag = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
  const toasts = await toastTexts();
  await page.screenshot({ path: join(shotDir, "stale-core-selfheal-geos-list.png"), fullPage: true });

  trace.screen = screen.slice(0, 400);
  trace.toasts = toasts;

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
  const libOk = (afterHeal.lib?.rowCount ?? seeded.lib?.rowCount ?? 0) >= 1;
  const notStuck = core.mismatch?.mismatch !== true || core.status?.diskExportsPresent === true;
  const pass = glueOk && exportsOk && listOk && toastOk && libOk && labelOk && notStuck;

  trace.pass = pass;
  trace.checks = { glueOk, exportsOk, listOk, toastOk, libOk, labelOk, notStuck };
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.log(
    JSON.stringify({
      pass,
      glueOk,
      exportsOk,
      listOk,
      toastOk,
      libOk,
      labelOk,
      notStuck,
      tag,
      loaded: core.status?.coreBuildIdLoaded,
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
