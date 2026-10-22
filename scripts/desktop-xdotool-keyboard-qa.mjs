#!/usr/bin/env node
/**
 * OS-level keyboard QA — xdotool into real Chromium under Xvfb (not page.keyboard).
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { patchLocalStorage, powerOnDesktop, waitRunning } from "./desktop-qa-lib.mjs";
import { assertGrok64WasmCore, clearEmulatorJsCache, grok64DatapathFromEnv } from "./desktop-grok64-core.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const display = process.env.GROK64_XDISPLAY || ":99";
const outDir = join(process.cwd(), "artifacts", "desktop-xdotool-keyboard-qa");
mkdirSync(outDir, { recursive: true });

function sh(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout?.on("data", (d) => (out += d));
    p.stderr?.on("data", (d) => (out += d));
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.join(" ")}: ${out}`))));
  });
}

function lineWith(text, needle) {
  const n = needle.replace(/\s+/g, "").toUpperCase();
  for (const line of text.split("\n")) {
    const compact = line.replace(/\s+/g, "").toUpperCase();
    if (compact.includes(n)) return line.trim();
  }
  return null;
}

const rows = [];
const push = (row) => {
  rows.push(row);
  console.log(row.pass ? "PASS" : "FAIL", row.id, row.detail ?? "");
};

let xvfb;
try {
  if (!grok64DatapathFromEnv()) throw new Error("VITE_GROK64_VICE_DATAPATH missing");
  xvfb = spawn("Xvfb", [display, "-screen", "0", "1280x800x24", "-ac"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 800));

  const browser = await chromium.launch({
    headless: false,
    env: { ...process.env, DISPLAY: display },
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1280,800"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await clearEmulatorJsCache(page);
  await patchLocalStorage(page, { video: "ntsc", jiffy: false });
  await page.reload();
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120000);
  await assertGrok64WasmCore(page, { timeoutMs: 120000 });
  await page.waitForFunction(() => /READY/i.test(window.__g64?.screenText?.() || ""), { timeout: 90_000 });

  let win = "";
  for (let i = 0; i < 30; i++) {
    try {
      const ids = (await sh("xdotool", ["search", "--class", "chromium"])).trim().split(/\s+/).filter(Boolean);
      win = ids[ids.length - 1] ?? "";
      if (win) break;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!win) throw new Error("xdotool: Chromium window not found");
  await sh("xdotool", ["windowactivate", "--sync", win]);
  await sh("xdotool", ["mousemove", "--window", win, "640", "300", "click", "1"]);
  await new Promise((r) => setTimeout(r, 400));

  await sh("xdotool", ["type", "--delay", "80", "--window", win, "PRINT 2+2"]);
  await new Promise((r) => setTimeout(r, 900));
  let text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  const printLine = lineWith(text, "PRINT 2+2");
  push({
    id: "xdo-print-2plus2",
    pass: (printLine ?? "").replace(/\s+/g, "").toUpperCase().includes("PRINT2+2"),
    detail: printLine,
  });

  await sh("xdotool", ["key", "--window", win, "Return"]);
  await new Promise((r) => setTimeout(r, 2200));
  text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  push({
    id: "xdo-print-run",
    pass: /\n\s*4\s*\n/m.test(text) || /\n\s*4\s*READY/m.test(text),
    detail: text.slice(-100),
  });

  await sh("xdotool", ["key", "--window", win, "Return"]);
  await new Promise((r) => setTimeout(r, 500));
  await sh("xdotool", ["type", "--delay", "80", "--window", win, 'LOAD"$",8']);
  await new Promise((r) => setTimeout(r, 1200));
  text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  const loadLine = lineWith(text, 'LOAD"$",8');
  push({
    id: "xdo-load-dollar",
    pass: (loadLine ?? "").replace(/\s+/g, "").toUpperCase().includes('LOAD"$",8'.replace(/\s+/g, "").toUpperCase()),
    detail: loadLine,
  });

  await browser.close();
} catch (e) {
  push({ id: "suite-error", pass: false, detail: String(e) });
} finally {
  xvfb?.kill("SIGTERM");
}

const failed = rows.filter((r) => !r.pass);
process.exit(failed.length ? 1 : 0);
