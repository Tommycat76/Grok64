import { chromium } from "playwright";

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

await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.getByRole("button", { name: "Power on" }).waitFor({ timeout: 15000 });
await page.getByRole("button", { name: "Power on" }).click();
await page.waitForSelector("canvas", { timeout: 90000 });
await page.waitForTimeout(8000);
const canvas = page.locator("canvas").first();
await canvas.screenshot({ path: "/workspace/screenshots/emu-canvas.png" });
const box = await canvas.boundingBox();

await page.locator('button[aria-label="Software"]').first().click({ force: true });
await page.getByText("Search games", { timeout: 8000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: "/workspace/screenshots/emu-library2.png" });
const catalog = await page.locator(".g64-catalog").count();
const hits = await page.locator(".g64-hit").count();
const body = (await page.locator(".g64-sheet").innerText().catch(() => "")).slice(0, 800);
console.log(JSON.stringify({ canvasBox: box, catalog, hits, body, errors }, null, 2));
await browser.close();
