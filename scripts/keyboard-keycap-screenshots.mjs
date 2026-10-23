#!/usr/bin/env node
/**
 * Desktop 1280×800 and tablet keyboard screenshots for keycap redesign QA.
 * Usage: node scripts/keyboard-keycap-screenshots.mjs <outDir> [baseUrl]
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const outDir = process.argv[2] ?? "screenshots";
const base = process.argv[3]?.startsWith("http") ? process.argv[3] : "http://127.0.0.1:8080/";

const viewports = [
  { name: "desktop-1280", width: 1280, height: 800, isMobile: false, hasTouch: false },
  { name: "tablet-1024", width: 1024, height: 768, isMobile: true, hasTouch: true },
];

mkdirSync(outDir, { recursive: true });

async function powerOn(page) {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator(".g64-power").waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    document.querySelector(".g64-power")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  for (let i = 0; i < 80; i++) {
    const on = await page.evaluate(() => window.__g64?.powered?.());
    if (on) break;
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(2000);
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

for (const vp of viewports) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
    locale: "en-US",
  });
  const page = await ctx.newPage();
  await powerOn(page);
  await page.getByRole("button", { name: "Keyboard" }).first().click({ timeout: 8000 });
  await page.waitForTimeout(900);
  const full = join(outDir, `keyboard-${vp.name}.png`);
  await page.screenshot({ path: full });
  const kb = join(outDir, `keyboard-${vp.name}-kb-only.png`);
  await page.locator(".g64-kb").screenshot({ path: kb }).catch(() => null);
  await ctx.close();
  console.log("wrote", full);
}

await browser.close();
