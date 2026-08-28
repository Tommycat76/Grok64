#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const url = process.argv[2] || "http://127.0.0.1:8080/";
const dir = "/workspace/screenshots";
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (err) => errors.push(String(err)));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${dir}/emu-splash.png`, fullPage: true });

const power = page.getByRole("button", { name: "Power on" });
await power.waitFor({ timeout: 15000 });
await power.click();

await page.waitForTimeout(1500);
await page.screenshot({ path: `${dir}/emu-booting.png` });

try {
  await page.waitForSelector("canvas", { timeout: 90000 });
} catch {
  console.log("no canvas yet");
}
await page.waitForTimeout(6000);
await page.screenshot({ path: `${dir}/emu-running.png` });

const lib = page.locator('button[aria-label="Software"]');
await lib.first().click({ force: true });
await page.getByText("Search games", { timeout: 8000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${dir}/emu-library.png` });

const sidChip = page.getByRole("tab", { name: "SID" });
await sidChip.click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${dir}/emu-catalog-sid.png` });

const commando = page.getByText("Commando", { exact: false }).first();
if (await commando.count()) {
  await commando.click();
  await page.waitForTimeout(12000);
  await page.screenshot({ path: `${dir}/emu-sid-play.png` });
}

const text = await page.locator("body").innerText();
console.log(JSON.stringify({
  errors,
  hasCanvas: (await page.locator("canvas").count()) > 0,
  hasCatalog: /Assembly64|Internet Archive|HVSC|Catalog/i.test(text),
  hasCommando: /Commando/i.test(text),
  textPrefix: text.replace(/\s+/g, " ").slice(0, 400),
}, null, 2));

await browser.close();
