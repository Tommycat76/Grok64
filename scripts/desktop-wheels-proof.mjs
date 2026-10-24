#!/usr/bin/env node
/**
 * Wheels + REU boot proof (canvas + screen heuristics).
 *   npm run test:desktop-wheels-proof
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { patchLocalStorage, powerOnDesktop, waitRunning } from "./desktop-qa-lib.mjs";
import { assertGrok64WasmCore, clearEmulatorJsCache, grok64DatapathFromEnv } from "./desktop-grok64-core.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const display = process.env.GROK64_XDISPLAY || ":99";
const geosDir = join(process.cwd(), "fixtures", "geos");
const outDir = join(process.cwd(), "screenshots", "wheels-proof");
const artDir = join(process.cwd(), "artifacts", "desktop-wheels-proof");
mkdirSync(outDir, { recursive: true });
mkdirSync(artDir, { recursive: true });

function pickWheels() {
  if (!existsSync(geosDir)) return null;
  const names = readdirSync(geosDir).filter((n) => /\.d64$/i.test(n) && /wheels/i.test(n));
  const prefer = names.find((n) => /^Wheels64\.d64$/i.test(n)) ?? names[0];
  return prefer ? join(geosDir, prefer) : null;
}

const wheelsPath = pickWheels();
if (!wheelsPath) {
  writeFileSync(join(artDir, "results.json"), JSON.stringify({ skipped: true, reason: "no Wheels .d64 in fixtures/geos" }));
  console.log("SKIP wheels proof");
  process.exit(0);
}
if (!grok64DatapathFromEnv()) {
  console.error("VITE_GROK64_VICE_DATAPATH missing");
  process.exit(1);
}

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
await assertGrok64WasmCore(page, { timeoutMs: 120_000 });

const name = wheelsPath.split("/").pop() || "Wheels64.d64";
const bytes = [...readFileSync(wheelsPath)];
const bootOk = await page.evaluate(
  async ({ name, bytes }) => Boolean(await window.__g64?.bootGeos?.(name, bytes)),
  { name, bytes },
);
await page.waitForTimeout(70_000);
const text = await page.evaluate(() => window.__g64?.screenText?.() || "");
const reu = await page.evaluate(() => window.__g64?.settings?.()?.reuSize);
await page.screenshot({ path: join(outDir, "wheels-desktop.png"), fullPage: true });
const pass = bootOk && /WHEELS|DASH|GEOS|CLICK/i.test(text) && reu && reu !== "none";
const report = { bootOk, reu, pass, textHead: text.slice(0, 200), file: name };
writeFileSync(join(artDir, "results.json"), JSON.stringify(report, null, 2));
console.log(pass ? "PASS wheels-proof" : "FAIL wheels-proof", JSON.stringify(report));
await browser.close();
await server.close();
xvfb.kill("SIGTERM");
process.exit(pass ? 0 : 1);
