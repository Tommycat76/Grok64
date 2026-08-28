import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const url = process.argv[2] || "http://127.0.0.1:8081/";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
await page.locator(".g64-power").waitFor({ timeout: 15000 });
await page.locator(".g64-power").click({ force: true });
await page.waitForSelector(".g64-top", { timeout: 20000 });
for (let i = 0; i < 80; i++) {
  if (await page.evaluate(() => window.__g64?.hasFs?.())) break;
  await page.waitForTimeout(400);
}

async function shot(name) {
  const b64 = await page.evaluate(async () => window.__g64?.shot?.());
  if (!b64) {
    console.log(name, "no shot");
    return null;
  }
  const buf = Buffer.from(b64, "base64");
  writeFileSync(`/workspace/screenshots/${name}.png`, buf);
  const sha = createHash("sha256").update(buf).digest("hex").slice(0, 16);
  console.log(name, buf.length, sha);
  return sha;
}

const loaded = await page.evaluate(async () => window.__g64?.load?.("/software/byte-hopper.prg", "byte-hopper.prg"));
console.log("load", loaded);
for (let i = 0; i < 40; i++) {
  const t = await page.evaluate(() => window.__g64?.title?.());
  if (t && /hopper/i.test(String(t))) break;
  await page.waitForTimeout(400);
}
await page.waitForTimeout(4000);
const idle = await shot("hopper-idle");

await page.evaluate(() => window.__g64?.stick?.(-1, 0));
await page.waitForTimeout(1600);
const left = await shot("hopper-left");
await page.evaluate(() => window.__g64?.stick?.(0, 0));
await page.waitForTimeout(400);

await page.evaluate(() => window.__g64?.stick?.(1, 0));
await page.waitForTimeout(1600);
const right = await shot("hopper-right");
await page.evaluate(() => window.__g64?.stick?.(0, 0));
await page.waitForTimeout(400);

await page.evaluate(() => window.__g64?.fire?.(true));
await page.waitForTimeout(1600);
const fire = await shot("hopper-fire");
await page.evaluate(() => window.__g64?.fire?.(false));
await page.screenshot({ path: "/workspace/screenshots/hopper-bezel.png" });

console.log("moved_left", idle !== left);
console.log("moved_right", left !== right);
console.log("fire_changed", idle !== fire);
console.log("title", await page.evaluate(() => window.__g64?.title?.()));
await browser.close();
process.exit(idle !== left || idle !== fire ? 0 : 2);
