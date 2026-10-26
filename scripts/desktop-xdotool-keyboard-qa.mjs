#!/usr/bin/env node
/**
 * OS-level keyboard QA — xdotool into real Chromium under Xvfb (not page.keyboard).
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  canvasLooksLikeCartMenu,
  canvasLooksLikeGeosDesktop,
  isBasicReadyScreen,
  patchLocalStorage,
  powerOnDesktop,
  waitRunning,
} from "./desktop-qa-lib.mjs";
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
  await patchLocalStorage(page, { video: "ntsc", jiffy: true, mouse: true, reu: "2048kB" });
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
  const legend = await page.evaluate(() => {
    const key = document.querySelector('[data-key-id="a"][data-petscii="true"]');
    const primary = key?.querySelector(".g64-key-primary");
    const corner = key?.querySelector(".g64-key-corner");
    if (!primary || !corner) return null;
    const ps = getComputedStyle(primary);
    const cs = getComputedStyle(corner);
    return {
      primaryPx: parseFloat(ps.fontSize || "0"),
      cornerOpacity: parseFloat(cs.opacity || "0"),
      primaryWeight: ps.fontWeight,
    };
  });
  push({
    id: "xdo-os-kb-petscii-legends",
    pass:
      Boolean(legend) &&
      legend.primaryPx >= 14 &&
      legend.cornerOpacity > 0.2 &&
      legend.cornerOpacity < 0.65 &&
      Number(legend.primaryWeight) >= 700,
    detail: legend,
  });
  const canvasBox = await page.locator("#grok64-player canvas:not(.grok64-ios-present)").first().boundingBox();
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

  const geosPath = join(process.cwd(), "fixtures", "geos", "GEOS64_2.0.d64");
  if (existsSync(geosPath)) {
    const geosBytes = [...readFileSync(geosPath)];
    const geosName = "GEOS64_2.0.d64";
    const geosOk = await page.evaluate(
      async ({ name, bytes }) => {
        return Boolean(await window.__g64?.bootGeos?.(name, bytes));
      },
      { name: geosName, bytes: geosBytes },
    );
    await waitRunning(page, 180_000);
    await page.waitForTimeout(52_000);
    let geosText = await page.evaluate(() => window.__g64?.screenText?.() || "");
    const geosOpts = await page.evaluate(() => window.__g64?.runtimeViceOpts?.() ?? {});
    const geosCanvas = await canvasLooksLikeGeosDesktop(page);
    const jiffyLive = await page.evaluate(() => window.__g64?.jiffyLive?.());
    push({
      id: "xdo-geos-bootGeos",
      pass:
        geosOk &&
        geosCanvas.pass &&
        !isBasicReadyScreen(geosText) &&
        !/FILE NOT FOUND|DEVICE NOT PRESENT/i.test(geosText) &&
        jiffyLive === false,
      detail: {
        tail: geosText.slice(-160),
        geosCanvas,
        jiffyLive,
        geosOpts: {
          drive8: geosOpts.vice_drive8_type,
          work: geosOpts.vice_work_disk,
          trueEmu: geosOpts.vice_drive_true_emulation,
        },
      },
    });
    push({
      id: "xdo-power-off-visible",
      pass: await page.locator(".g64-power-pin").isVisible(),
      detail: "desktop pinned Power off",
    });
    await page.evaluate(() => window.__g64?.resetReady?.());
    await page.waitForFunction(() => /READY/i.test(window.__g64?.screenText?.() || ""), { timeout: 60_000 });
    await new Promise((r) => setTimeout(r, 800));
  } else {
    push({ id: "xdo-geos-bootGeos", pass: true, skipped: true, detail: "fixtures/geos missing" });
  }

  const ar6Path = join(process.cwd(), "fixtures", "carts", "ar6.crt");
  if (existsSync(ar6Path)) {
    await page.evaluate(() => window.__g64?.resetReady?.());
    await page.waitForFunction(() => /READY/i.test(window.__g64?.screenText?.() || ""), { timeout: 60_000 });
    await new Promise((r) => setTimeout(r, 600));
    const arBytes = [...readFileSync(ar6Path)];
    const arName = "Action_Replay_V6.0_6.0_1989_PAL.crt";
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    await page.evaluate(
      async ({ name, bytes }) => {
        await window.__g64?.playBytes?.(name, bytes, { autostart: true });
      },
      { name: arName, bytes: arBytes },
    );
    await waitRunning(page, 120000);
    await page.waitForFunction(() => window.__g64?.sessionFlags?.().cart === true, { timeout: 60_000 });
    await new Promise((r) => setTimeout(r, 12_000));
    await page.evaluate(() => window.__g64?.kbdDrain?.());
    let arText = await page.evaluate(() => window.__g64?.screenText?.() || "");
    const arCanvas = await canvasLooksLikeCartMenu(page);
    push({
      id: "xdo-ar6-boot",
      pass: arCanvas.pass && !isBasicReadyScreen(arText),
      detail: { text: arText.slice(0, 90), arCanvas },
    });
    const freezeOk = await page.evaluate(() => window.__g64?.cartFreeze?.());
    await page.evaluate(() => window.__g64?.kbdDrain?.());
    await new Promise((r) => setTimeout(r, 2800));
    const afterFreeze = await page.evaluate(() => window.__g64?.screenText?.() || "");
    const freezeCanvas = await canvasLooksLikeCartMenu(page, { minBuckets: 35 });
    push({
      id: "xdo-ar6-freeze",
      pass:
        Boolean(freezeOk) &&
        freezeCanvas.pass &&
        !isBasicReadyScreen(afterFreeze),
      detail: { text: afterFreeze.slice(0, 90), freezeCanvas },
    });
    await sh("xdotool", ["key", "--window", win, "F7"]);
    await page.evaluate(() => window.__g64?.kbdDrain?.());
    await new Promise((r) => setTimeout(r, 1200));
    const afterF7 = await page.evaluate(() => window.__g64?.screenText?.() || "");
    push({
      id: "xdo-ar6-f7",
      pass: afterF7.length > 8,
      detail: afterF7.slice(0, 90),
    });
    push({
      id: "xdo-ar6-console-errors",
      pass: pageErrors.length < 8,
      detail: { count: pageErrors.length, sample: pageErrors.slice(0, 3) },
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
