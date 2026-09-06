#!/usr/bin/env node
/** iPhone playability: controls reach VICE after a catalog game loads. */
import { chromium } from "playwright";

const url = process.argv[2] || "http://127.0.0.1:8080/";

const browser = await chromium.launch({
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/135.0.7049.53 Mobile/15E148 Safari/604.1",
});
const page = await context.newPage();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForFunction(() => typeof window.__g64?.power === "function", { timeout: 20000 });
await page.evaluate(() => window.__g64.power());

for (let i = 0; i < 60; i++) {
  const ok = await page.evaluate(
    () => window.__g64?.hasFs?.() && window.__g64?.running?.() && window.__g64?.title?.() === "BASIC",
  );
  if (ok) break;
  await page.waitForTimeout(500);
}

await page.locator('button[aria-label="Software"]').first().click();
await page.locator(".g64-sheet").waitFor({ state: "visible", timeout: 8000 });
await page.locator(".g64-search input").fill("Boulder Dash");
await page.locator('.g64-search button[type="submit"]').click();
await page.waitForTimeout(2500);
const playHit = page.locator(".g64-hit").filter({ hasText: /boulder/i }).first();
if (!(await playHit.count())) {
  console.log("FAIL no Boulder Dash hit");
  await browser.close();
  process.exit(2);
}
await playHit.locator('button[aria-label^="Play"]').click();

for (let i = 0; i < 80; i++) {
  const st = await page.evaluate(() => ({
    title: window.__g64?.title?.() ?? "",
    playLock: window.__g64?.playLock?.() ?? true,
    unlock: !!document.querySelector(".g64-unlock"),
  }));
  if (/boulder/i.test(st.title) && !st.playLock) break;
  await page.waitForTimeout(250);
}

const stick = page.locator(".g64-stick");
await stick.waitFor({ state: "visible", timeout: 8000 });

await page.evaluate(() => {
  window.__g64.stick(1, 0);
  window.__g64.fire(true);
});
await page.waitForTimeout(120);
await page.evaluate(() => window.__g64.fire(false));

const probe = await page.evaluate(() => {
  const joy = window.__g64?.joy?.() ?? {};
  const logs = (window.__g64log || []).filter((l) => /fire-blocked|play-lock|play-unlock/.test(String(l)));
  const unlock = !!document.querySelector(".g64-unlock");
  const boot = !!document.querySelector(".g64-boot");
  const shot = window.__g64?.canvasShot?.() ?? null;
  return {
    joy,
    unlock,
    boot,
    canvasBytes: shot?.bytes ?? 0,
    title: window.__g64?.title?.() ?? null,
    playLock: window.__g64?.playLock?.() ?? null,
    logs: logs.slice(-8),
  };
});

console.log("PLAY", JSON.stringify(probe));
await browser.close();

if (!/boulder/i.test(probe.title || "")) {
  console.log("FAIL game title never switched from BASIC");
  process.exit(2);
}
if (probe.unlock) {
  console.log("FAIL tap-to-wake unlock overlay still present");
  process.exit(2);
}
if (probe.playLock) {
  console.log("FAIL play lock never cleared");
  process.exit(2);
}
if (probe.joy.x === 0 && !probe.logs.some((l) => String(l).includes("play-unlock"))) {
  console.log("FAIL stick input did not register");
  process.exit(2);
}
console.log("PASS iphone playability after game load");
process.exit(0);
