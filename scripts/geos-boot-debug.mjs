#!/usr/bin/env node
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { patchLocalStorage, powerOnDesktop, waitRunning } from "./desktop-qa-lib.mjs";
import { assertGrok64WasmCore, clearEmulatorJsCache, grok64DatapathFromEnv } from "./desktop-grok64-core.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const display = process.env.GROK64_XDISPLAY || ":99";
const geosPath = join(process.cwd(), "fixtures", "geos", "GEOS64_2.0.d64");
const geosBytes = [...readFileSync(geosPath)];

const xvfb = spawn("Xvfb", [display, "-screen", "0", "1280x800x24", "-ac"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 600));
const server = await chromium.launchServer({
  headless: false,
  env: { ...process.env, DISPLAY: display },
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1280,800"],
});
const browser = await chromium.connect(server.wsEndpoint());
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(base, { waitUntil: "domcontentloaded" });
await clearEmulatorJsCache(page);
await patchLocalStorage(page, { video: "pal", jiffy: false, mouse: true, reu: "2048kB" });
await page.reload({ waitUntil: "domcontentloaded" });
await powerOnDesktop(page, base, { navigate: false });
await waitRunning(page, 120_000);
await assertGrok64WasmCore(page);

const mount = await page.evaluate(
  async ({ name, bytes }) => window.__g64?.geosMountAndDir?.(name, bytes),
  { name: "GEOS64_2.0.d64", bytes: geosBytes },
);
console.log("mount", JSON.stringify({ ...mount, dir: mount?.dir?.slice(0, 500) }, null, 2));

for (const cmd of ['LOAD"GEOS",8,1', 'LOAD"RBOOT",8,1', 'LOAD"*",8,1']) {
  await page.evaluate(async () => {
    await window.__g64?.hardReset?.();
    await new Promise((r) => setTimeout(r, 3000));
  });
  await page.evaluate(
    async ({ name, bytes }) => window.__g64?.geosMountAndDir?.(name, bytes),
    { name: "GEOS64_2.0.d64", bytes: geosBytes },
  );
  await page.evaluate(async (line) => {
    await window.__g64?.feedBasic?.(line);
    await new Promise((r) => setTimeout(r, 25000));
    const mid = window.__g64?.screenText?.() || "";
    if (/LOADING/i.test(mid)) await new Promise((r) => setTimeout(r, 20000));
    await window.__g64?.feedBasic?.("RUN");
    await new Promise((r) => setTimeout(r, 12000));
    return window.__g64?.screenText?.() || "";
  }, cmd);
  const text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  console.log("\n===", cmd, "===\n", text.slice(0, 400));
}

await browser.close();
await server.close();
xvfb.kill("SIGTERM");
