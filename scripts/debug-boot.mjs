import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(15000);
await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 20000 });
await page.getByRole("button", { name: "Power on" }).click();
for (let i = 0; i < 20; i++) {
  const n = await page.locator("canvas").count();
  if (n > 0) { console.log("canvas at", i, "s"); break; }
  await page.waitForTimeout(1000);
}
await page.waitForTimeout(5000);
await page.screenshot({ path: "/workspace/screenshots/debug-boot.png" });
const n = await page.locator("canvas").count();
console.log("canvases", n);
if (n) {
  await page.locator("canvas").first().screenshot({ path: "/workspace/screenshots/emu-canvas.png" });
}
await page.locator('button[aria-label="Software"]').first().click({ force: true });
await page.waitForTimeout(2500);
await page.screenshot({ path: "/workspace/screenshots/emu-library2.png" });
const sheet = await page.locator(".g64-sheet").count();
let body = "";
if (sheet) body = await page.locator(".g64-sheet").innerText();
console.log(JSON.stringify({ sheet, hits: await page.locator(".g64-hit").count(), body: body.slice(0, 900) }, null, 2));
await browser.close();
