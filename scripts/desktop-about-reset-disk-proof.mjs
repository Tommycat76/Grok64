#!/usr/bin/env node
/** About must not type IEC probe on CRT; reset keeps GEOS disk for LOAD"$",8. */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { assertGrok64WasmCore, grok64DatapathFromEnv, installGrok64CoreNetworkGuard } from "./desktop-grok64-core.mjs";
import { applySyntheticJiffy } from "./drive-combo-qa-lib.mjs";
import {
  geosDirectoryOnScreen,
  patchLocalStorage,
  powerOnDesktop,
  waitForDollarLoad,
  waitForG64,
  waitRunning,
} from "./desktop-qa-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const shotDir = join(process.cwd(), "screenshots");
const outDir = join(process.cwd(), "artifacts", "desktop-about-reset-disk");
mkdirSync(shotDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

spawnSync(process.execPath, ["scripts/prepare-floppy-fixtures.mjs"], { stdio: "inherit" });
const d64Path = join(process.cwd(), "fixtures", "geos", "GEOS_2.0.d64");
if (!grok64DatapathFromEnv() || !existsSync(d64Path)) {
  console.log(JSON.stringify({ pass: false, skipped: true }));
  process.exit(0);
}

const d64Name = "GEOS_2.0.d64";
const d64B64 = readFileSync(d64Path).toString("base64");
const trace = {};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await installGrok64CoreNetworkGuard(page, base);

try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  const jiffyOn = process.env.GROK64_JIFFY_PROOF !== "0";
  await patchLocalStorage(page, { video: "pal", jiffy: jiffyOn, reu: "2048kB" });
  await waitForG64(page);
  await page.evaluate(async ({ name, b64 }) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.__g64?.importLibraryBytes?.(name, bin);
  }, { name: d64Name, b64: d64B64 });
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
  await assertGrok64WasmCore(page, { timeoutMs: 120_000 });
  if (jiffyOn) {
    await applySyntheticJiffy(page);
    await page.evaluate(() => window.__g64?.setJiffyDos?.(true));
    await page.waitForTimeout(800);
  }
  await page.evaluate(async (name) => {
    await window.__g64?.insertLibraryByName?.(name);
  }, d64Name);
  await waitRunning(page, 60_000);
  await page.waitForTimeout(1500);

  const beforeAbout = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  await page.getByRole("button", { name: "About" }).click({ timeout: 15_000 });
  await page.waitForTimeout(2500);
  const duringAbout = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  const diag = await page.evaluate(async () => window.__g64?.attachDiskDiag?.({ light: true }));
  trace.aboutDiagMs = diag?.coreBuildMatches;
  trace.diagHasReattach = diag?.viceLastReattach?.rc === 0;
  trace.iecWasm = diag?.iecWasmDriveState;
  await page.screenshot({ path: join(shotDir, "hands-on-about-drive8-diag.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  const afterAboutClose = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  trace.aboutTyping =
    /OPEN\s*15|PRINT#15|INPUT#15|\?SYNTAX\s+ERROR/i.test(duringAbout) ||
    /OPEN\s*15|PRINT#15/i.test(afterAboutClose);

  await page.evaluate(() => window.__g64?.resetReady?.());
  await page.waitForTimeout(8000);
  await page.screenshot({ path: join(shotDir, "hands-on-after-reset-ready.png") });
  await page.evaluate(async () => {
    await window.__g64?.feedBasic?.('LOAD"$",8', { runcmd: true });
    await window.__g64?.feedBasic?.("LIST", { runcmd: true });
  });
  const loadWait = await waitForDollarLoad(page, { maxMs: 90_000 });
  const screenAfter = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  await page.screenshot({ path: join(shotDir, "hands-on-after-reset-list.png") });
  trace.resetListOk = geosDirectoryOnScreen(screenAfter) || geosDirectoryOnScreen(loadWait?.text ?? "");
  trace.resetAttach = (await page.evaluate(() => window.__g64?.viceAttachedImage?.(8))) ?? null;
  trace.loadWait = loadWait;
  trace.screenAfter = screenAfter.slice(0, 1200);

  const pass =
    !trace.aboutTyping &&
    trace.diagHasReattach === true &&
    Boolean(diag?.coreBuildMatches) &&
    trace.resetListOk === true &&
    !/FILE NOT FOUND/i.test(screenAfter);

  trace.pass = pass;
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.log(JSON.stringify({ pass, aboutTyping: trace.aboutTyping, resetListOk: trace.resetListOk, resetAttach: trace.resetAttach }));
  process.exit(pass ? 0 : 1);
} catch (e) {
  trace.error = String(e?.message || e);
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.error(e);
  process.exit(1);
} finally {
  await browser.close();
}
