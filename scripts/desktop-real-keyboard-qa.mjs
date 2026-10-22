#!/usr/bin/env node
/**
 * Real Chromium keyboard QA — page.keyboard.type with per-key delay.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { patchLocalStorage, powerOnDesktop, waitRunning } from "./desktop-qa-lib.mjs";
import { assertGrok64WasmCore, clearEmulatorJsCache, grok64DatapathFromEnv } from "./desktop-grok64-core.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const outDir = join(process.cwd(), "artifacts", "desktop-real-keyboard-qa");
mkdirSync(outDir, { recursive: true });

const rows = [];
const push = (row) => {
  rows.push(row);
  console.log(row.pass ? "PASS" : "FAIL", row.id, row.detail ?? row.reason ?? "");
};

function lineWith(text, needle) {
  const n = needle.replace(/\s+/g, "").toUpperCase();
  for (const line of text.split("\n")) {
    const compact = line.replace(/\s+/g, "").toUpperCase();
    if (compact.includes(n)) return line.trim();
  }
  return null;
}

async function waitReady(page, timeoutMs = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const text = await page.evaluate(() => window.__g64?.screenText?.() || "");
    if (/READY/i.test(text)) return text;
    await page.waitForTimeout(400);
  }
  throw new Error("READY timeout");
}

async function canvasMetrics(page) {
  return page.evaluate(() => {
    const c = document.querySelector("#grok64-player canvas:not(.g64-ios-present)");
    if (!c) return null;
    return {
      w: c.width,
      h: c.height,
      clientW: c.clientWidth,
      clientH: c.clientHeight,
      visible: c.clientWidth > 80 && c.clientHeight > 80,
    };
  });
}

async function focusC64(page) {
  await page.evaluate(() => {
    const c = document.querySelector("#grok64-player canvas:not(.g64-ios-present)");
    if (c instanceof HTMLElement) {
      c.tabIndex = 0;
      c.focus();
    }
    document.getElementById("grok64-player")?.focus?.();
  });
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

try {
  if (!grok64DatapathFromEnv()) throw new Error("VITE_GROK64_VICE_DATAPATH missing");
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await clearEmulatorJsCache(page);
  await patchLocalStorage(page, { video: "ntsc", jiffy: false });
  await page.reload();
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120000);
  await assertGrok64WasmCore(page, { timeoutMs: 120000 });
  await waitReady(page);

  const retroKbd = await page.evaluate(() => typeof window.__ejs?.Module?._grok64_retro_keyboard === "function");
  push({ id: "retro-keyboard-export", pass: retroKbd, detail: retroKbd ? null : "missing _grok64_retro_keyboard" });

  await focusC64(page);
  await page.keyboard.type("PRINT 2+2", { delay: 85 });
  await page.waitForTimeout(600);
  let text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  const printLine = lineWith(text, "PRINT 2+2");
  const printCompact = (printLine ?? "").replace(/\s+/g, "").toUpperCase();
  push({
    id: "physical-print-2plus2",
    pass: printCompact.includes("PRINT2+2"),
    detail: { line: printLine },
  });

  await page.keyboard.down("Enter");
  await page.waitForTimeout(50);
  await page.keyboard.up("Enter");
  await page.waitForTimeout(2000);
  text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  const hasFour = /\n\s*4\s*\n/m.test(text) || /\n\s*4\s*READY/m.test(text);
  push({
    id: "physical-print-2plus2-run",
    pass: hasFour,
    detail: text.slice(-120),
  });

  await page.keyboard.down("Enter");
  await page.waitForTimeout(40);
  await page.keyboard.up("Enter");
  await page.waitForTimeout(600);
  await focusC64(page);
  await page.keyboard.type('LOAD"$",8', { delay: 150 });
  await page.waitForTimeout(1200);
  text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  const loadLine = lineWith(text, 'LOAD"$",8');
  const loadCompact = (loadLine ?? text).replace(/\s+/g, "").toUpperCase();
  push({
    id: "physical-load-dollar",
    pass: loadCompact.includes('LOAD"$",8'.replace(/\s+/g, "").toUpperCase()),
    detail: { line: loadLine ?? lineWith(text, "LOAD") },
  });

  const beforeKb = await canvasMetrics(page);
  await page.getByRole("button", { name: "Keyboard" }).click();
  await page.waitForTimeout(600);
  const afterKb = await canvasMetrics(page);
  push({
    id: "os-kb-crt-visible",
    pass: Boolean(beforeKb?.visible && afterKb?.visible && afterKb.clientH >= 60),
    detail: { beforeKb, afterKb },
  });

  await page.evaluate(() => window.__g64?.setShowKeyboard?.(true));
  await page.waitForTimeout(400);
  for (const ch of ["P", "R", "I", "N", "T"]) {
    await page.getByRole("button", { name: ch, exact: true }).click();
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(500);
  text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  const osLine = lineWith(text, "PRINT");
  const osCompact = (osLine ?? "").replace(/\s+/g, "").toUpperCase();
  push({
    id: "os-kb-print",
    pass: osCompact.includes("PRINT") && !/NRPINT|PRIT|NPRI/i.test(osCompact),
    detail: { line: osLine },
  });

  await page.evaluate(() => window.__g64?.setShowKeyboard?.(false));
  await page.waitForTimeout(300);
  await focusC64(page);
  await page.keyboard.press("F1");
  await page.waitForTimeout(400);
  await page.keyboard.press("F7");
  await page.waitForTimeout(400);
  const alive = await page.evaluate(() => typeof window.__g64?.screenText === "function");
  push({ id: "f1-f7-no-crash", pass: alive, detail: { alive } });
} catch (e) {
  push({ id: "suite-error", pass: false, detail: String(e) });
}

await browser.close();
const failed = rows.filter((r) => !r.pass);
process.exit(failed.length ? 1 : 0);
