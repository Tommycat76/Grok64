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

function logs() {
  return page.evaluate(() => window.__g64log ?? []);
}

function count(hay, re) {
  return hay.filter((l) => re.test(String(l))).length;
}

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator(".g64-splash").waitFor({ timeout: 20000 });
await page.waitForTimeout(800);
await page.evaluate(() => window.__g64?.power?.());
for (let i = 0; i < 50; i++) {
  const st = await page.evaluate(() => ({
    fs: window.__g64?.hasFs?.(),
    running: window.__g64?.running?.(),
    splash: !!document.querySelector(".g64-splash"),
  }));
  if (st.fs && st.running && !st.splash) break;
  await page.waitForTimeout(400);
}
const powered = await page.evaluate(() => ({
  fs: window.__g64?.hasFs?.(),
  running: window.__g64?.running?.(),
  splash: !!document.querySelector(".g64-splash"),
  title: window.__g64?.title?.(),
}));
console.log("POWERED", JSON.stringify(powered));
if (!powered.fs || powered.splash) {
  console.log("LOG", (await logs()).slice(-12));
  await browser.close();
  process.exit(2);
}

await page.evaluate(async () => {
  await window.__g64.load("/software/byte-hopper.prg", "byte-hopper.prg");
});
for (let i = 0; i < 40; i++) {
  const t = await page.evaluate(() => String(window.__g64?.title?.() || ""));
  if (/hopper/i.test(t)) break;
  await page.waitForTimeout(400);
}
await page.waitForTimeout(2500);
await page.screenshot({ path: "/workspace/screenshots/fire-stay-title.png" });

const before = await logs();
const bootsBefore = count(before, /boot-begin|power-on|kickAutostart|hot-swap|core-start/);
console.log("TITLE", await page.evaluate(() => window.__g64?.title?.()));
console.log("bootsBefore", bootsBefore);

async function firePulse() {
  const btn = page.locator(".g64-fire");
  if (await btn.count()) {
    await btn.dispatchEvent("pointerdown");
    await page.waitForTimeout(250);
    await btn.dispatchEvent("pointerup");
  } else {
    await page.evaluate(() => window.__g64?.fire?.(true));
    await page.waitForTimeout(250);
    await page.evaluate(() => window.__g64?.fire?.(false));
  }
}

await firePulse();
await page.waitForTimeout(1800);
await page.screenshot({ path: "/workspace/screenshots/fire-stay-1.png" });
const after1 = await logs();
const boots1 = count(after1, /boot-begin|power-on|kickAutostart/);
const fires1 = count(after1, /FIRE down/);
console.log("AFTER1", JSON.stringify({
  title: await page.evaluate(() => window.__g64?.title?.()),
  splash: await page.evaluate(() => !!document.querySelector(".g64-splash")),
  running: await page.evaluate(() => window.__g64?.running?.()),
  boots: boots1,
  fires: fires1,
  last: after1.slice(-8),
}));

await firePulse();
await page.waitForTimeout(1200);
await page.screenshot({ path: "/workspace/screenshots/fire-stay-2.png" });
const after2 = await logs();
const boots2 = count(after2, /boot-begin|power-on|kickAutostart/);
console.log("AFTER2", JSON.stringify({
  title: await page.evaluate(() => window.__g64?.title?.()),
  splash: await page.evaluate(() => !!document.querySelector(".g64-splash")),
  running: await page.evaluate(() => window.__g64?.running?.()),
  boots: boots2,
  last: after2.slice(-8),
}));

await browser.close();
if (boots2 > bootsBefore) {
  console.log("FAIL restart after fire");
  process.exit(2);
}
if (fires1 < 1) {
  console.log("FAIL no FIRE down");
  process.exit(2);
}
if (await page.evaluate(() => !!document.querySelector(".g64-splash")).catch(() => false)) {
  console.log("FAIL splash returned");
  process.exit(2);
}
console.log("PASS fire did not restart");
process.exit(0);
