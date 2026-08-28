import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const url = process.argv[2] || "http://127.0.0.1:8081/";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator(".g64-power").click({ timeout: 10000 });
for (let i = 0; i < 60; i++) {
  if (await page.evaluate(() => window.__g64?.hasFs?.())) break;
  await page.waitForTimeout(400);
}
console.log("fs", await page.evaluate(() => window.__g64?.hasFs?.()));
await page.locator('button[aria-label="Software"]').first().dispatchEvent("click");
await page.locator(".g64-sheet").waitFor({ state: "visible", timeout: 8000 });
await page.evaluate(() => {
  const btns = [...document.querySelectorAll(".g64-sheet button")];
  btns.find((b) => /on this device|library/i.test(b.textContent || ""))?.click();
});
await page.waitForTimeout(400);
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".g64-sheet .g64-card")];
  cards.find((b) => /byte hopper/i.test(b.textContent || ""))?.click();
});
for (let i = 0; i < 40; i++) {
  const t = await page.evaluate(() => window.__g64?.title?.());
  if (t && /hopper/i.test(String(t))) break;
  await page.waitForTimeout(500);
}
await page.waitForTimeout(4000);
const before = await page.evaluate(async () => window.__g64?.shot?.());
if (before) writeFileSync("/workspace/screenshots/hopper-before.png", Buffer.from(before, "base64"));
const probe = await page.evaluate(() => window.__g64?.probe?.());
console.log("PROBE", JSON.stringify(probe));
await page.evaluate(() => window.__g64?.fire?.(true));
await page.waitForTimeout(800);
await page.evaluate(() => window.__g64?.fire?.(false));
await page.waitForTimeout(1500);
const after = await page.evaluate(async () => window.__g64?.shot?.());
if (after) writeFileSync("/workspace/screenshots/hopper-after-fire.png", Buffer.from(after, "base64"));
console.log("title", await page.evaluate(() => window.__g64?.title?.()));
await page.screenshot({ path: "/workspace/screenshots/hopper-bezel.png" });
await browser.close();
