#!/usr/bin/env node
/**
 * Wheels 64 desktop QA — real Chromium + xdotool mouse on the CRT (not CDP keyboard).
 *
 * Needs a Wheels .d64 (filename must contain "wheels"). Search order:
 *   GROK64_WHEELS_DIR → GROK64_GEOS_DIR → private-c64/geos → fixtures/geos
 *
 *   npm run test:desktop-xdotool-wheels
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { canvasHasSignal, patchLocalStorage, powerOnDesktop, waitRunning } from "./desktop-qa-lib.mjs";
import { assertGrok64WasmCore, clearEmulatorJsCache, grok64DatapathFromEnv } from "./desktop-grok64-core.mjs";
import { createServer } from "vite";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const display = process.env.GROK64_XDISPLAY || ":99";
const FIX = join(process.cwd(), "fixtures");
const outDir = join(process.cwd(), "artifacts", "desktop-xdotool-wheels-qa");
mkdirSync(outDir, { recursive: true });

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});
const { geosFamilyDesktopOk } = await vite.ssrLoadModule("/src/lib/emu/geos-boot.ts");
await vite.close();

function resolveWheelsD64() {
  const dirs = [
    process.env.GROK64_WHEELS_DIR,
    process.env.GROK64_GEOS_DIR,
    join(process.cwd(), "private-c64", "geos"),
    join(FIX, "geos"),
  ].filter(Boolean);
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const hit = readdirSync(dir).find((f) => /wheels/i.test(f) && /\.d64$/i.test(f));
    if (hit) return { path: join(dir, hit), name: hit, dir };
  }
  return null;
}

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

const wheels = resolveWheelsD64();
const rows = [];
const push = (row) => {
  rows.push(row);
  console.log(row.pass ? "PASS" : row.skipped ? "SKIP" : "FAIL", row.id, row.detail ?? "");
};

if (!wheels) {
  const report = {
    skipped: true,
    reason: "No Wheels .d64 — add private-c64/geos/Wheels*.d64 or set GROK64_WHEELS_DIR",
    searched: ["GROK64_WHEELS_DIR", "GROK64_GEOS_DIR", "private-c64/geos", "fixtures/geos"],
  };
  writeFileSync(join(outDir, "results.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  process.exit(0);
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
  await patchLocalStorage(page, { video: "ntsc", mouse: true, joy: 2, drive: "1541", reu: "none", jiffy: false });
  await page.reload();
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120000);
  await assertGrok64WasmCore(page, { timeoutMs: 120000 });

  const fileBuf = readFileSync(wheels.path);
  push({ id: "wheels-image", pass: fileBuf.byteLength >= 170_000, detail: `${wheels.name} ${fileBuf.byteLength} bytes` });
  if (fileBuf.byteLength < 170_000) throw new Error("Wheels image too small — likely not a valid .d64");

  const bootOk = await page.evaluate(
    async ({ name, bytes }) => {
      return Boolean(await window.__g64?.bootGeos?.(name, bytes));
    },
    { name: wheels.name, bytes: Array.from(fileBuf) },
  );
  push({ id: "wheels-bootGeos", pass: bootOk, detail: wheels.name });

  await waitRunning(page, 180_000);
  await page.waitForTimeout(20_000);

  const settings = await page.evaluate(() => window.__g64?.settings?.());
  const reuOk = settings?.reuSize && settings.reuSize !== "none" && settings.reuSize !== "256kB";
  push({
    id: "wheels-reu-enabled",
    pass: Boolean(reuOk && settings?.mouseMode),
    detail: { reuSize: settings?.reuSize, mouseMode: settings?.mouseMode },
  });

  let screen = await page.evaluate(() => window.__g64?.screenText?.() || "");
  const desktopOk = geosFamilyDesktopOk(screen, wheels.name);
  push({
    id: "wheels-desktop-text",
    pass: desktopOk,
    detail: screen.slice(0, 140),
  });

  await page.bringToFront();
  const win = await findChromiumWindow(server);
  if (!win) throw new Error("xdotool: Chromium window not found");

  const canvasBox = await page.locator("#grok64-player canvas:not(.g64-ios-present)").first().boundingBox();
  push({
    id: "wheels-crt-visible",
    pass: Boolean(canvasBox && canvasBox.width >= 200 && canvasBox.height >= 150),
    detail: canvasBox ? `${Math.round(canvasBox.width)}x${Math.round(canvasBox.height)}` : "no canvas",
  });

  if (canvasBox) {
    const mx = Math.round(canvasBox.x + canvasBox.width * 0.55);
    const my = Math.round(canvasBox.y + canvasBox.height * 0.45);
    await sh("xdotool", ["mousemove", "--window", win, String(mx), String(my), "click", "1"]);
    await new Promise((r) => setTimeout(r, 400));
    await sh("xdotool", ["mousemove", "--window", win, String(mx + 40), String(my + 30), "click", "1"]);
    await new Promise((r) => setTimeout(r, 600));
    const signal = await canvasHasSignal(page);
    const stillRunning = await page.evaluate(() => window.__g64?.running?.() && !window.__g64?.booting?.());
    push({
      id: "wheels-xdo-mouse-crt",
      pass: Boolean(signal && stillRunning),
      detail: { mx, my, signal, stillRunning },
    });
  } else {
    push({ id: "wheels-xdo-mouse-crt", pass: false, detail: "no canvas box" });
  }

  await page.screenshot({ path: join(outDir, "wheels-desktop.png"), fullPage: true });
  writeFileSync(join(outDir, "results.json"), JSON.stringify({ wheels: wheels.name, rows }, null, 2));
  await browser.close();
} catch (e) {
  push({ id: "suite-error", pass: false, detail: String(e) });
  writeFileSync(join(outDir, "results.json"), JSON.stringify({ wheels: wheels?.name, rows }, null, 2));
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
