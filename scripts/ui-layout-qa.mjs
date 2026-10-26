#!/usr/bin/env node
/**
 * Capture Grok64 UI layouts (keyboard, controls, full app) for phone/tablet
 * portrait + landscape. Usage:
 *   node scripts/ui-layout-qa.mjs [baseUrl] [--phase before|after]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit, devices } from "playwright";

const base = process.argv[2]?.startsWith("http") ? process.argv[2] : "http://127.0.0.1:8080/";
const phaseArg = process.argv.find((a) => a.startsWith("--phase="));
const phase = phaseArg ? phaseArg.split("=")[1] : process.argv.includes("--before") ? "before" : process.argv.includes("--after") ? "after" : "after";
const outRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "screenshots", phase);
mkdirSync(outRoot, { recursive: true });

const profiles = [
  { id: "iphone-portrait", device: devices["iPhone 13"] },
  { id: "iphone-landscape", device: { ...devices["iPhone 13"], viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true } },
  { id: "android-phone", device: devices["Pixel 7"] },
  { id: "ipad-portrait", device: devices["iPad Pro 11"] },
  { id: "ipad-landscape", device: { ...devices["iPad Pro 11"], viewport: { width: 1194, height: 834 }, isMobile: true, hasTouch: true } },
];

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
  for (let i = 0; i < 50; i++) {
    if ((await page.locator("canvas").count()) > 0) break;
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(4000);
}

async function captureProfile(browserType, profile) {
  const browser = await browserType.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ ...profile.device, locale: "en-US" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await powerOn(page);
  const dir = join(outRoot, profile.id);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, "ui-full.png"), fullPage: true });
  await page.locator(".g64-bezel").screenshot({ path: join(dir, "crt.png") }).catch(() => null);
  await page.getByRole("button", { name: "Keyboard" }).first().click({ timeout: 5000 }).catch(() => null);
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(dir, "ui-keyboard-open.png"), fullPage: true });
  await page.locator(".g64-kb").screenshot({ path: join(dir, "keyboard.png") }).catch(() => null);
  await page.getByRole("button", { name: "Keyboard" }).first().click({ timeout: 3000 }).catch(() => null);
  await page.waitForTimeout(400);
  await page.locator(".g64-controls").screenshot({ path: join(dir, "controls.png") }).catch(() => null);
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ profile: profile.id, phase, errors, base }, null, 2));
  await browser.close();
  return { id: profile.id, errors };
}

const results = [];
for (const profile of profiles) {
  results.push(await captureProfile(chromium, profile));
}
try {
  results.push(await captureProfile(webkit, { id: "iphone-webkit", device: devices["iPhone 13"] }));
} catch (e) {
  results.push({ id: "iphone-webkit", errors: [String(e).split("\n")[0]] });
}

console.log(JSON.stringify({ phase, outRoot, results }, null, 2));
