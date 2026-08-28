import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const url = process.argv[2] || "http://127.0.0.1:8080/";
mkdirSync("/workspace/screenshots", { recursive: true });

const browser = await chromium.launch({
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl"],
});
const context = await browser.newContext({
  viewport: { width: 1200, height: 2000 },
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (Linux; Android 13; TBAF11 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Safari/537.36",
});
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 160)));

const logs = () => page.evaluate(() => window.__g64log ?? []);

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator(".g64-splash").waitFor({ timeout: 20000 });
await page.waitForFunction(() => typeof window.__g64?.power === "function", { timeout: 15000 });
await page.evaluate(() => window.__g64.power());
for (let i = 0; i < 60; i++) {
  const st = await page.evaluate(() => ({
    fs: window.__g64?.hasFs?.(),
    running: window.__g64?.running?.(),
    booting: window.__g64?.booting?.(),
    lock: window.__g64?.playLock?.(),
  }));
  if (st.fs && st.running && !st.booting && !st.lock) break;
  await page.waitForTimeout(400);
}

await page.locator('button[aria-label="Software"]').first().click();
await page.locator(".g64-sheet").waitFor({ state: "visible", timeout: 8000 });
const search = page.locator(".g64-search input");
await search.fill("Boulder Dash");
await page.locator('.g64-search button[type="submit"]').click();
await page.waitForTimeout(3500);

const first = page.locator(".g64-hit").first();
const title = await first.locator("strong").innerText();
const sub = await first.locator("span").innerText().catch(() => "");
console.log("HIT", title, "|", sub);
if (/construction|kit|awally/i.test(`${title} ${sub}`)) {
  console.log("FAIL junk disk listed first");
  await browser.close();
  process.exit(2);
}

await first.locator('button[aria-label^="Play"]').click();
console.log("clicked play");

for (let i = 0; i < 90; i++) {
  const t = String(await page.evaluate(() => window.__g64?.title?.() || ""));
  const last = (await logs()).slice(-1)[0];
  if (/boulder/i.test(t) || /hot-swap|play \{/.test(String(last))) {
    if (i > 10) break;
  }
  await page.waitForTimeout(400);
}

await page.keyboard.press("Escape").catch(() => undefined);
await page.locator(".g64-sheet").waitFor({ state: "hidden", timeout: 4000 }).catch(() => undefined);

for (let i = 0; i < 40; i++) {
  const st = await page.evaluate(() => ({
    booting: window.__g64?.booting?.(),
    lock: window.__g64?.playLock?.(),
    port: window.__g64?.joyPort?.(),
    title: window.__g64?.title?.(),
  }));
  if (!st.booting && !st.lock) {
    console.log("READY", JSON.stringify(st));
    break;
  }
  await page.waitForTimeout(400);
}

const port = await page.evaluate(() => window.__g64?.joyPort?.());
const before = await logs();
await page.screenshot({ path: "/workspace/screenshots/bd-title.png" });
const grabbed = await page.evaluate(() => window.__g64?.canvasShot?.());
if (grabbed?.b64) writeFileSync("/workspace/screenshots/bd-title-canvas.png", Buffer.from(grabbed.b64, "base64"));

await page.evaluate(() => window.__g64?.fire?.(true));
await page.waitForTimeout(600);
await page.evaluate(() => window.__g64?.fire?.(false));
await page.waitForTimeout(1500);
await page.screenshot({ path: "/workspace/screenshots/bd-after-fire.png" });
const grabbed2 = await page.evaluate(() => window.__g64?.canvasShot?.());
if (grabbed2?.b64) writeFileSync("/workspace/screenshots/bd-after-fire-canvas.png", Buffer.from(grabbed2.b64, "base64"));

const after = await logs();
const splash = await page.evaluate(() => !!document.querySelector(".g64-splash"));
const boots = after.filter((l) => /boot-begin|power-on|kickAutostart/.test(String(l))).length
  - before.filter((l) => /boot-begin|power-on|kickAutostart/.test(String(l))).length;
const autoplug = after.filter((l) => /joy-autoplug/.test(String(l))).slice(-3);
console.log("AFTER", JSON.stringify({
  title: await page.evaluate(() => window.__g64?.title?.()),
  port,
  splash,
  extraBoots: boots,
  autoplug,
  last: after.slice(-8),
}));

await browser.close();
if (splash || boots > 0) {
  console.log("FAIL reboot on fire");
  process.exit(2);
}
if (port !== 1) {
  console.log("FAIL not on port 1");
  process.exit(2);
}
console.log("PASS catalog BD on port 1, fire did not reboot");
process.exit(0);
