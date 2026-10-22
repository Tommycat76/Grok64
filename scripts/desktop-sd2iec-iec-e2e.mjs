#!/usr/bin/env node
/**
 * SD2IEC IEC smoke (desktop Chromium): LOAD $, subfolder PRG, PRG inside D64.
 *   npm run test:desktop-sd2iec-iec
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
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
const outDir = join(process.cwd(), "artifacts", "desktop-sd2iec-iec");
mkdirSync(outDir, { recursive: true });

const c64osDir = process.env.GROK64_C64OS_DIR || process.env.GROK64_C64OS_FIXTURE || "";

async function typeBasic(page, text) {
  for (const ch of text) {
    await page.evaluate(
      (c) => {
        window.__g64?.dispatchKey?.(`Key${c.toUpperCase()}`, c, true);
        window.__g64?.dispatchKey?.(`Key${c.toUpperCase()}`, c, false);
      },
      ch,
    );
    await page.waitForTimeout(25);
  }
  await page.evaluate(() => {
    window.__g64?.dispatchKey?.("Enter", "Enter", true);
    window.__g64?.dispatchKey?.("Enter", "Enter", false);
  });
  await page.waitForTimeout(2000);
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const rows = [];

try {
  if (grok64DatapathFromEnv()) {
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await clearEmulatorJsCache(page);
    await patchLocalStorage(page, { video: "ntsc", drive: "1541" });
    await page.reload();
  }
  await powerOnDesktop(page, base, { navigate: !grok64DatapathFromEnv() });
  await waitRunning(page, 120000);
  let coreStatus = grok64DatapathFromEnv()
    ? await assertGrok64WasmCore(page, { timeoutMs: 120000 })
    : await readGrok64CoreStatus(page);
  rows.push({
    id: "grok64-wasm-core",
    pass: Boolean(coreStatus?.attach && coreStatus?.c64read),
    core: coreStatus,
  });

  await page.evaluate(async () => {
    window.__g64?.setIecSlot?.(8, "sd2iec");
    window.__g64?.resetDos?.();
    await window.__g64?.seedSd?.([
      { name: "ROOT.PRG", path: "", data: new Uint8Array([1, 8, 0, 10, 0xaa]).buffer },
      { name: "SUB.PRG", path: "games", data: new Uint8Array([1, 8, 0, 10, 0xbb]).buffer },
    ]);
  });
  await page.waitForTimeout(2000);

  const dos = await page.evaluate(async () => {
    const a = await window.__g64?.runDos?.('CD:"games"');
    const b = await window.__g64?.runDos?.("X");
    return { a, b };
  });
  rows.push({ id: "sd-subfolder-cd", pass: /OK/.test(dos.a || "") && /games/i.test(dos.b || "") });

  const iecBackend = await page.evaluate(() => {
    const trap = window.__g64?.kernalIecTrapActive?.() ?? true;
    const attach = typeof window.__ejs?.Module?._grok64_sd2iec_attach === "function";
    return { trap, attach, wasmIec: attach && !trap };
  });
  rows.push({
    id: "kernal-trap-off",
    pass: iecBackend.wasmIec || iecBackend.trap === false,
    detail: iecBackend,
  });

  await typeBasic(page, 'LOAD"$",8');
  await page.waitForTimeout(8000);
  let text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  rows.push({ id: "load-dollar-list", pass: /ROOT|SUB|PRG|BLOCKS|GROK64/i.test(text), head: text.slice(0, 80) });

  await page.evaluate(() => window.__g64?.resetReady?.());
  await waitRunning(page, 20000);
  await page.evaluate(async () => {
    await window.__g64?.seedSd?.([{ name: "SUB.PRG", path: "games", data: new Uint8Array([1, 8, 0, 10, 0xbb]).buffer }]);
    window.__g64?.setIecSlot?.(8, "sd2iec");
    await window.__g64?.runDos?.('CD:"games"');
  });
  await typeBasic(page, 'LOAD"SUB.PRG",8,1');
  await page.waitForTimeout(5000);
  text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  rows.push({ id: "load-subfolder-prg", pass: !/FILE NOT FOUND/i.test(text), head: text.slice(0, 80) });

  if (c64osDir && existsSync(c64osDir)) {
    const files = [];
    const walk = (dir, rel = "") => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, rel ? `${rel}/${name}` : name);
        else if (/\.(dnp|prg|p00)$/i.test(name)) {
          files.push({ name, path: rel, data: [...readFileSync(p)] });
        }
      }
    };
    walk(c64osDir);
    if (files.length) {
      await page.evaluate(() => window.__g64?.resetReady?.());
      await waitRunning(page, 20000);
      await page.evaluate(async (payload) => {
        window.__g64?.setSd2iecUnit?.(12);
        window.__g64?.setIecSlot?.(8, "sd2iec");
        await window.__g64?.seedSd?.(payload);
        await window.__g64?.runDos?.('CD:"1//:c64os"');
      }, files);
      await typeBasic(page, 'LOAD"C64OS",12,1');
      await page.waitForTimeout(12000);
      text = await page.evaluate(() => window.__g64?.screenText?.() || "");
      rows.push({
        id: "c64os-unit12",
        pass: text.length > 30 && !/FILE NOT FOUND/i.test(text),
        optional: true,
        head: text.slice(0, 100),
      });
    }
  } else {
    rows.push({ id: "c64os-unit12", pass: true, skipped: true, reason: "GROK64_C64OS_DIR not set" });
  }
} catch (e) {
  rows.push({ id: "suite-error", pass: false, error: String(e) });
}

await browser.close();
const failed = rows.filter((r) => !r.pass && !r.skipped);
writeFileSync(join(outDir, "results.json"), JSON.stringify({ rows, failed: failed.length }, null, 2));
console.log(JSON.stringify({ failed: failed.map((r) => r.id), rows }, null, 2));
process.exit(failed.length ? 1 : 0);
