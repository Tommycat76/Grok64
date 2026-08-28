import { chromium } from "playwright";

const url = process.argv[2] || "http://127.0.0.1:8080/";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1",
});
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 160)));

const logs = () => page.evaluate(() => window.__g64log ?? []);
const count = (hay, re) => hay.filter((l) => re.test(String(l))).length;

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator(".g64-splash").waitFor({ timeout: 20000 });
await page.waitForTimeout(800);
await page.evaluate(() => window.__g64?.power?.());
for (let i = 0; i < 50; i++) {
  if (await page.evaluate(() => window.__g64?.hasFs?.() && window.__g64?.running?.())) break;
  await page.waitForTimeout(400);
}
if (!(await page.evaluate(() => window.__g64?.hasFs?.()))) {
  console.log("no fs", (await logs()).slice(-8));
  await browser.close();
  process.exit(2);
}

await page.locator('button[aria-label="Software"]').first().click();
await page.locator(".g64-sheet").waitFor({ state: "visible", timeout: 8000 });
const search = page.locator(".g64-search input");
await search.fill("Boulder Dash");
await page.locator('.g64-search button[type="submit"]').click();
await page.waitForTimeout(2500);
await page.screenshot({ path: "/workspace/screenshots/fire-bd-catalog.png" });

const playHit = page.locator(".g64-hit").filter({ hasText: /boulder/i }).first();
if (!(await playHit.count())) {
  console.log("NO HITS", await page.locator(".g64-sheet").innerText());
  await browser.close();
  process.exit(3);
}
await playHit.locator('button[aria-label^="Play"]').click();
console.log("clicked play");

for (let i = 0; i < 80; i++) {
  const t = String(await page.evaluate(() => window.__g64?.title?.() || ""));
  const last = (await logs()).slice(-1)[0];
  if (/boulder/i.test(t) || /hot-swap|play \{/.test(String(last))) {
    if (i > 8) break;
  }
  await page.waitForTimeout(500);
}
await page.waitForTimeout(8000);
await page.keyboard.press("Escape").catch(() => undefined);
await page.locator(".g64-sheet").waitFor({ state: "hidden", timeout: 3000 }).catch(() => undefined);
await page.screenshot({ path: "/workspace/screenshots/fire-bd-title.png" });

const before = await logs();
const bootsBefore = count(before, /boot-begin|power-on|kickAutostart/);
console.log("PREFIRE", JSON.stringify({
  title: await page.evaluate(() => window.__g64?.title?.()),
  splash: await page.evaluate(() => !!document.querySelector(".g64-splash")),
  running: await page.evaluate(() => window.__g64?.running?.()),
  bootsBefore,
  last: before.slice(-10),
}));

async function firePulse() {
  const btn = page.locator(".g64-fire");
  if (await btn.count()) {
    await btn.dispatchEvent("pointerdown");
    await page.waitForTimeout(300);
    await btn.dispatchEvent("pointerup");
  }
  await page.evaluate(() => window.__g64?.fire?.(true));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__g64?.fire?.(false));
}

await firePulse();
await page.waitForTimeout(2000);
await page.screenshot({ path: "/workspace/screenshots/fire-bd-1.png" });
const after1 = await logs();
console.log("AFTER1", JSON.stringify({
  title: await page.evaluate(() => window.__g64?.title?.()),
  splash: await page.evaluate(() => !!document.querySelector(".g64-splash")),
  running: await page.evaluate(() => window.__g64?.running?.()),
  boots: count(after1, /boot-begin|power-on|kickAutostart/),
  fires: count(after1, /FIRE down/),
  last: after1.slice(-12),
}));

await firePulse();
await page.waitForTimeout(1500);
await page.screenshot({ path: "/workspace/screenshots/fire-bd-2.png" });
const after2 = await logs();
const boots2 = count(after2, /boot-begin|power-on|kickAutostart/);
const splash = await page.evaluate(() => !!document.querySelector(".g64-splash"));
console.log("AFTER2", JSON.stringify({
  title: await page.evaluate(() => window.__g64?.title?.()),
  splash,
  running: await page.evaluate(() => window.__g64?.running?.()),
  boots: boots2,
  last: after2.slice(-10),
}));

await browser.close();
if (splash) {
  console.log("FAIL splash returned");
  process.exit(2);
}
if (boots2 > bootsBefore) {
  console.log("FAIL restart after fire");
  process.exit(2);
}
console.log("PASS boulder dash fire did not restart");
process.exit(0);
