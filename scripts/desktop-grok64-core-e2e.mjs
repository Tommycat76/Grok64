#!/usr/bin/env node
/**
 * Mandatory Grok64 custom WASM core gate (desktop Chromium).
 * Fails unless grok64CoreStatus reports attach + c64read after power-on.
 *   npm run test:desktop-grok64-core
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { patchLocalStorage, powerOnDesktop, waitRunning } from "./desktop-qa-lib.mjs";
import {
  assertGrok64WasmCore,
  clearEmulatorJsCache,
  grok64DatapathFromEnv,
  readGrok64CoreStatus,
} from "./desktop-grok64-core.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const outDir = join(process.cwd(), "artifacts", "desktop-grok64-core-e2e");
mkdirSync(outDir, { recursive: true });

if (!grok64DatapathFromEnv()) {
  const skip = { skipped: true, reason: "VITE_GROK64_VICE_DATAPATH not set" };
  writeFileSync(join(outDir, "results.json"), JSON.stringify(skip, null, 2));
  console.log(JSON.stringify(skip));
  process.exit(0);
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

let core = null;
let error = null;
try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await clearEmulatorJsCache(page);
  await patchLocalStorage(page, { video: "ntsc", drive: "1541", reu: "none" });
  await page.reload();
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120000);
  core = await assertGrok64WasmCore(page, { timeoutMs: 120000 });
  await page.waitForTimeout(3000);
  const text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  const pass = Boolean(core?.attach && core?.c64read && core?.diskAttach);
  const report = { pass, core, screenTextLen: text.length, screenPrefix: text.slice(0, 60) };
  writeFileSync(join(outDir, "results.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
  process.exit(pass ? 0 : 1);
} catch (e) {
  error = e instanceof Error ? e.message : String(e);
  core = await readGrok64CoreStatus(page).catch(() => null);
  const report = { pass: false, core, error };
  writeFileSync(join(outDir, "results.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
  process.exit(1);
}
