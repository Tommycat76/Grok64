#!/usr/bin/env node
/**
 * OS-style keyboard QA — CDP Input.dispatchKeyEvent (real keydown/keyup timing),
 * optional xdotool when GROK64_XDOTOOL=1 and Xvfb is available.
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { patchLocalStorage, powerOnDesktop, waitRunning } from "./desktop-qa-lib.mjs";
import { assertGrok64WasmCore, clearEmulatorJsCache, grok64DatapathFromEnv } from "./desktop-grok64-core.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const KEY_DELAY_MS = Number(process.env.GROK64_KEY_DELAY_MS || 80);
const HOLD_MS = Number(process.env.GROK64_KEY_HOLD_MS || 48);

const rows = [];
const push = (row) => {
  rows.push(row);
  console.log(row.pass ? "PASS" : "FAIL", row.id, row.detail ?? "");
};

function lineWith(text, needle) {
  const n = needle.replace(/\s+/g, "").toUpperCase();
  for (const line of text.split("\n")) {
    const compact = line.replace(/\s+/g, "").toUpperCase();
    if (compact.includes(n)) return line.trim();
  }
  return null;
}

const US = {
  P: { code: "KeyP", key: "P", vk: 80, shift: true },
  R: { code: "KeyR", key: "R", vk: 82, shift: true },
  I: { code: "KeyI", key: "I", vk: 73, shift: true },
  N: { code: "KeyN", key: "N", vk: 78, shift: true },
  T: { code: "KeyT", key: "T", vk: 84, shift: true },
  " ": { code: "Space", key: " ", vk: 32 },
  "2": { code: "Digit2", key: "2", vk: 50 },
  "+": { code: "Equal", key: "+", vk: 187 },
  L: { code: "KeyL", key: "L", vk: 76, shift: true },
  O: { code: "KeyO", key: "O", vk: 79, shift: true },
  A: { code: "KeyA", key: "A", vk: 65, shift: true },
  D: { code: "KeyD", key: "D", vk: 68, shift: true },
  '"': { code: "Quote", key: '"', vk: 222 },
  $: { code: "Digit4", key: "$", vk: 52 },
  ",": { code: "Comma", key: ",", vk: 188 },
  "8": { code: "Digit8", key: "8", vk: 56 },
  Enter: { code: "Enter", key: "Enter", vk: 13 },
  F1: { code: "F1", key: "F1", vk: 112 },
  F7: { code: "F7", key: "F7", vk: 118 },
  Shift: { code: "ShiftLeft", key: "Shift", vk: 16 },
};

async function cdpTap(client, spec, down, modifiers = 0) {
  await client.send("Input.dispatchKeyEvent", {
    type: down ? "keyDown" : "keyUp",
    modifiers: down ? modifiers : 0,
    windowsVirtualKeyCode: spec.vk,
    code: spec.code,
    key: spec.key,
    text: down && spec.key.length === 1 && !modifiers ? spec.key : undefined,
  });
}

async function cdpStroke(client, spec) {
  const mod = spec.shift ? 8 : 0;
  if (spec.shift) await cdpTap(client, US.Shift, true);
  await cdpTap(client, spec, true, mod);
  await new Promise((r) => setTimeout(r, HOLD_MS));
  await cdpTap(client, spec, false, mod);
  if (spec.shift) await cdpTap(client, US.Shift, false);
  await new Promise((r) => setTimeout(r, KEY_DELAY_MS));
}

async function cdpType(client, chars) {
  for (const ch of chars) {
    const spec = US[ch];
    if (!spec) throw new Error(`no US map for ${ch}`);
    await cdpStroke(client, spec);
  }
}

async function runCdp(page) {
  const client = await page.context().newCDPSession(page);
  await page.evaluate(() => {
    const c = document.querySelector("#grok64-player canvas:not(.g64-ios-present)");
    if (c instanceof HTMLElement) {
      c.tabIndex = 0;
      c.focus();
    }
  });
  await cdpType(client, "PRINT 2+2".split(""));
  await page.waitForTimeout(600);
  let text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  const printLine = lineWith(text, "PRINT 2+2");
  push({
    id: "cdp-print-2plus2",
    pass: (printLine ?? "").replace(/\s+/g, "").toUpperCase().includes("PRINT2+2"),
    detail: printLine,
  });

  await cdpStroke(client, US.Enter);
  await page.waitForTimeout(2200);
  text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  push({
    id: "cdp-print-run",
    pass: /\n\s*4\s*\n/m.test(text) || /\n\s*4\s*READY/m.test(text),
    detail: text.slice(-100),
  });

  await cdpStroke(client, US.Enter);
  await page.waitForTimeout(400);
  for (const ch of 'LOAD"$",8'.split("")) {
    await cdpStroke(client, US[ch] ?? { code: "Digit" + ch, key: ch, vk: ch.charCodeAt(0) });
    if (ch === '"' || ch === "$") await page.waitForTimeout(180);
  }
  await page.waitForTimeout(2000);
  text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  const loadLine = lineWith(text, 'LOAD"$",8');
  push({
    id: "cdp-load-dollar",
    pass: (loadLine ?? "").replace(/\s+/g, "").toUpperCase().includes('LOAD"$",8'.replace(/\s+/g, "").toUpperCase()),
    detail: loadLine,
  });

  await cdpStroke(client, US.F1);
  await page.waitForTimeout(400);
  await cdpStroke(client, US.F7);
  await page.waitForTimeout(400);
  const alive = await page.evaluate(() => typeof window.__g64?.screenText === "function");
  push({ id: "cdp-f1-f7", pass: alive, detail: { alive } });
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
  await page.waitForFunction(() => /READY/i.test(window.__g64?.screenText?.() || ""), { timeout: 90_000 });
  await runCdp(page);
} catch (e) {
  push({ id: "suite-error", pass: false, detail: String(e) });
}
await browser.close();
process.exit(rows.some((r) => !r.pass) ? 1 : 0);
