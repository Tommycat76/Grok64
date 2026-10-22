#!/usr/bin/env node
/**
 * OS-level keyboard QA — xdotool into real Chromium under Xvfb (not page.keyboard).
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { patchLocalStorage, powerOnDesktop, waitRunning } from "./desktop-qa-lib.mjs";
import { assertGrok64WasmCore, clearEmulatorJsCache, grok64DatapathFromEnv } from "./desktop-grok64-core.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const display = process.env.GROK64_XDISPLAY || ":99";
const outDir = join(process.cwd(), "artifacts", "desktop-xdotool-keyboard-qa");
mkdirSync(outDir, { recursive: true });

function sh(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      env: { ...process.env, DISPLAY: display, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
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

async function windowArea(id) {
  try {
    const out = await sh("xdotool", ["getwindowgeometry", "--shell", id]);
    const w = Number(/WIDTH=(\d+)/.exec(out)?.[1] ?? 0);
    const h = Number(/HEIGHT=(\d+)/.exec(out)?.[1] ?? 0);
    return w * h;
  } catch {
    return 0;
  }
}

async function findChromiumWindow(server) {
  const pid = server.process()?.pid;
  const tries = [
    ...(pid ? [() => sh("xdotool", ["search", "--pid", String(pid)])] : []),
    () => sh("xdotool", ["search", "--onlyvisible", "--class", "chromium"]),
    () => sh("xdotool", ["search", "--onlyvisible", "--class", "chrome"]),
    () => sh("xdotool", ["search", "--name", "8080"]),
  ];
  for (let i = 0; i < 50; i++) {
    for (const t of tries) {
      try {
        const ids = (await t()).trim().split(/\s+/).filter(Boolean);
        let best = "";
        let bestArea = 0;
        for (const id of ids) {
          const area = await windowArea(id);
          if (area > bestArea) {
            bestArea = area;
            best = id;
          }
        }
        if (best && bestArea > 80_000) return best;
      } catch {
        /* retry */
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return "";
}

let xvfb;
let server;
try {
  if (!grok64DatapathFromEnv()) throw new Error("VITE_GROK64_VICE_DATAPATH missing");
  xvfb = spawn("Xvfb", [display, "-screen", "0", "1280x800x24", "-ac"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 800));

  server = await chromium.launchServer({
    headless: false,
    env: { ...process.env, DISPLAY: display },
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1280,800"],
  });
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await clearEmulatorJsCache(page);
  await patchLocalStorage(page, { video: "ntsc", jiffy: false });
  await page.reload();
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120000);
  await assertGrok64WasmCore(page, { timeoutMs: 120000 });
  await page.waitForFunction(() => /READY/i.test(window.__g64?.screenText?.() || ""), { timeout: 90_000 });

  await page.bringToFront();
  await new Promise((r) => setTimeout(r, 600));
  const win = await findChromiumWindow(server);
  if (!win) throw new Error("xdotool: Chromium window not found");
  await sh("xdotool", ["mousemove", "--window", win, "640", "300", "click", "1"]);
  await new Promise((r) => setTimeout(r, 500));

  await sh("xdotool", ["type", "--delay", "100", "--window", win, "PRINT 2+2"]);
  await new Promise((r) => setTimeout(r, 1200));
  let text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  const printLine = lineWith(text, "PRINT 2+2");
  push({
    id: "xdo-print-2plus2",
    pass: (printLine ?? "").replace(/\s+/g, "").toUpperCase().includes("PRINT2+2"),
    detail: printLine,
  });

  await sh("xdotool", ["key", "--window", win, "Return"]);
  await new Promise((r) => setTimeout(r, 2800));
  text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  push({
    id: "xdo-print-run",
    pass: /\n\s*4\s*\n/m.test(text) || /\n\s*4\s*READY/m.test(text),
    detail: text.slice(-120),
  });

  await sh("xdotool", ["key", "--window", win, "Return"]);
  await new Promise((r) => setTimeout(r, 500));
  await sh("xdotool", ["type", "--delay", "100", "--window", win, "PRINT 5-2"]);
  await page.evaluate(() => window.__g64?.kbdDrain?.());
  await new Promise((r) => setTimeout(r, 900));
  text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  push({
    id: "xdo-print-5minus2",
    pass: (lineWith(text, "PRINT 5-2") ?? "").replace(/\s+/g, "").toUpperCase().includes("PRINT5-2"),
    detail: lineWith(text, "PRINT 5-2"),
  });
  await sh("xdotool", ["key", "--window", win, "Return"]);
  await page.evaluate(() => window.__g64?.kbdDrain?.());
  await new Promise((r) => setTimeout(r, 2800));
  text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  push({
    id: "xdo-print-5minus2-run",
    pass: /\n\s*3\s*\n/m.test(text) || /\n\s*3\s*READY/m.test(text),
    detail: text.slice(-120),
  });

  const kbBtn = page.locator('[aria-label="Keyboard"]').first();
  await kbBtn.click({ timeout: 15_000, force: true });
  await page.waitForSelector('.g64-app[data-kb="true"]', { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 500));
  const canvasBox = await page.locator("#grok64-player canvas:not(.g64-ios-present)").first().boundingBox();
  push({
    id: "xdo-os-kb-crt-visible",
    pass: Boolean(canvasBox && canvasBox.width >= 120 && canvasBox.height >= 80),
    detail: canvasBox ? `${Math.round(canvasBox.width)}x${Math.round(canvasBox.height)}` : "no canvas box",
  });

  await sh("xdotool", ["key", "--window", win, "Return"]);
  await new Promise((r) => setTimeout(r, 400));
  await page.locator(".g64-kb-bar button").filter({ hasText: "123" }).click({ force: true });
  await page.locator('[data-key-id="2"]').click({ force: true });
  await new Promise((r) => setTimeout(r, 600));
  text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  const osTapLine = text.split("\n").map((l) => l.trim()).filter(Boolean).slice(-2).join(" | ");
  push({
    id: "xdo-os-kb-tap",
    pass: /^2$/m.test(text) || osTapLine.startsWith("2"),
    detail: osTapLine,
  });
  await kbBtn.click({ force: true });
  await new Promise((r) => setTimeout(r, 300));

  await sh("xdotool", ["key", "--window", win, "Return"]);
  await new Promise((r) => setTimeout(r, 400));
  await sh("xdotool", ["type", "--delay", "80", "--window", win, "NEW"]);
  await sh("xdotool", ["key", "--window", win, "Return"]);
  await page.evaluate(() => window.__g64?.kbdDrain?.());
  await new Promise((r) => setTimeout(r, 600));
  await sh("xdotool", ["type", "--delay", "120", "--window", win, 'LOAD"$",8']);
  await page.evaluate(() => window.__g64?.kbdDrain?.());
  await new Promise((r) => setTimeout(r, 800));
  text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  const loadCompact = text.replace(/\s+/g, "").toUpperCase();
  const loadLine = lineWith(text, 'LOAD"$",8');
  push({
    id: "xdo-load-dollar",
    pass:
      loadCompact.includes('LOAD"$",8'.replace(/\s+/g, "").toUpperCase()) &&
      !loadCompact.includes("LOAD\"$\"<8") &&
      !(loadLine ?? "").includes("<"),
    detail: loadLine ?? text.slice(-220),
  });

  const ar6Path = join(process.cwd(), "fixtures", "carts", "ar6.crt");
  if (existsSync(ar6Path)) {
    const arBytes = [...readFileSync(ar6Path)];
    const arName = "Action_Replay_V6.0_6.0_1989_PAL.crt";
    await page.evaluate(
      async ({ name, bytes }) => {
        await window.__g64?.playBytes?.(name, bytes, { autostart: true });
      },
      { name: arName, bytes: arBytes },
    );
    await waitRunning(page, 120000);
    await page.waitForFunction(() => window.__g64?.sessionFlags?.().cart === true, { timeout: 60_000 });
    await new Promise((r) => setTimeout(r, 5500));
    await page.evaluate(() => window.__g64?.kbdDrain?.());
    let arText = await page.evaluate(() => window.__g64?.screenText?.() || "");
    const readyOnly = /^\s*READY\.?\s*$/m.test(arText.trim());
    push({
      id: "xdo-ar6-boot",
      pass: !readyOnly && arText.replace(/\s+/g, "").length > 12,
      detail: arText.slice(0, 90),
    });
    await sh("xdotool", ["key", "--window", win, "F1"]);
    await page.evaluate(() => window.__g64?.kbdDrain?.());
    await new Promise((r) => setTimeout(r, 1800));
    const afterF1 = await page.evaluate(() => window.__g64?.screenText?.() || "");
    push({
      id: "xdo-ar6-f1",
      pass:
        afterF1.length > 20 &&
        (afterF1 !== arText || /REPLAY|FREEZE|AR |DISK|FILE|MONITOR/i.test(afterF1)),
      detail: afterF1.slice(0, 90),
    });
  } else {
    push({ id: "xdo-ar6-boot", pass: true, skipped: true, detail: "fixtures/carts/ar6.crt missing" });
    push({ id: "xdo-ar6-f1", pass: true, skipped: true, detail: "fixtures/carts/ar6.crt missing" });
  }

  await page.screenshot({ path: join(outDir, "final.png") });
  writeFileSync(join(outDir, "results.json"), JSON.stringify(rows, null, 2));

  await browser.close();
} catch (e) {
  push({ id: "suite-error", pass: false, detail: String(e) });
} finally {
  try {
    await server?.close();
  } catch {
    /* ignore */
  }
  xvfb?.kill("SIGTERM");
}

const failed = rows.filter((r) => !r.pass && !r.skipped);
process.exit(failed.length ? 1 : 0);
