#!/usr/bin/env node
/**
 * Power on → import GEOS d64 → insert on 8 → LOAD"$",8 → LIST must show GEOS (not WORK DISK).
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  assertGrok64WasmCore,
  grok64DatapathFromEnv,
  installGrok64CoreNetworkGuard,
} from "./desktop-grok64-core.mjs";
import {
  baselineCoreDiagOk,
  baselineDriveLiveOk,
  geosDirectoryOnScreen,
  geosFloppyEvidence,
  patchLocalStorage,
  powerOnDesktop,
  waitForDollarLoad,
  waitForG64,
  waitRunning,
} from "./desktop-qa-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const outDir = join(process.cwd(), "artifacts", "desktop-geos-insert-list");
const shotDir = join(process.cwd(), "screenshots");
mkdirSync(outDir, { recursive: true });
mkdirSync(shotDir, { recursive: true });

spawnSync(process.execPath, ["scripts/prepare-floppy-fixtures.mjs"], { stdio: "inherit" });

const d64Path =
  process.env.GROK64_GEOS_D64_PATH ||
  (existsSync(join(process.cwd(), "fixtures", "geos", "GEOS_2.0.d64"))
    ? join(process.cwd(), "fixtures", "geos", "GEOS_2.0.d64")
    : null);

if (!grok64DatapathFromEnv() || !d64Path) {
  console.log(JSON.stringify({ pass: false, skipped: true }));
  process.exit(0);
}

const d64Name = d64Path.split("/").pop() ?? "GEOS_2.0.d64";
const d64B64 = readFileSync(d64Path).toString("base64");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await installGrok64CoreNetworkGuard(page, base);

const trace = { d64Name };

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
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
  await assertGrok64WasmCore(page, { timeoutMs: 120_000 });

  await page.evaluate(async (name) => {
    await window.__g64?.insertLibraryByName?.(name);
  }, d64Name);
  await waitRunning(page, 60_000);
  await page.waitForTimeout(2000);

  const preList = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
  trace.preList = {
    viceAttachedImage: preList?.viceAttachedImage,
    viceDriveLive: preList?.viceDriveLive,
    wasmFsStat: preList?.attachPathProbe?.map((p) => ({ path: p.path, wasm: p.wasmFsStat, js: p.jsFsBytes })),
    loadedGlueHasDiskExports: preList?.loadedGlueHasDiskExports,
  };
  await page.screenshot({ path: join(shotDir, "geos-after-insert.png") });

  await page.evaluate(async () => {
    await window.__g64?.feedBasic?.('LOAD"$",8', { runcmd: true });
    await window.__g64?.feedBasic?.("LIST", { runcmd: true });
  });
  await page.waitForTimeout(12_000);
  const loadWait = await waitForDollarLoad(page, { maxMs: 60_000 });
  trace.loadWait = loadWait;
  const screenAfter = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  trace.list = { ok: geosDirectoryOnScreen(screenAfter), text: screenAfter.slice(0, 1600) };
  await page.screenshot({ path: join(shotDir, "geos-after-list.png") });

  const postDiag = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
  const iecProbe = await page.evaluate(async () => window.__g64?.iecErrorChannelProbe?.(8));
  trace.iecProbe = iecProbe;
  const live = {
    ...(postDiag?.viceDriveLive ?? preList?.viceDriveLive),
    iecErrorChannel: iecProbe?.text ?? "",
  };
  const attachRc = postDiag?.viceLastReattach?.rc ?? preList?.viceLastReattach?.rc ?? -1;
  trace.attachRc = attachRc;
  const evidence = geosFloppyEvidence({
    screen: [loadWait?.text, screenAfter].filter(Boolean).join("\n"),
    session: postDiag?.session ?? preList?.session,
    wasmWorkDisk: postDiag?.wasmWorkDisk,
    viceAttachedImage: postDiag?.viceAttachedImage ?? preList?.viceAttachedImage,
  });
  const pass =
    attachRc === 0 &&
    evidence.ok &&
    trace.list?.ok === true &&
    evidence.onScreen === true &&
    loadWait?.done === true &&
    !loadWait?.error &&
    baselineCoreDiagOk(postDiag ?? preList) &&
    baselineDriveLiveOk(live);
  trace.evidence = evidence;
  trace.pass = pass;
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.log(
    JSON.stringify({ pass, listOk: trace.list?.ok, attachRc, attached: preList?.viceAttachedImage }),
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
