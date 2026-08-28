import { chromium } from "playwright";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
page.on("console", (m) => {
  const t = m.text();
  if (/error|Error|g64|nipple|Failed/i.test(t)) console.log("CON", t.slice(0, 200));
});
await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator(".g64-splash").waitFor({ timeout: 20000 });
console.log("splash ok");
await page.waitForTimeout(1000);
const info = await page.evaluate(() => ({
  hasG64: typeof window.__g64,
  keys: window.__g64 ? Object.keys(window.__g64) : [],
  powered: window.__g64?.powered?.(),
  logs: window.__g64log,
}));
console.log("PRE", JSON.stringify(info));
const r = await page.evaluate(() => {
  try {
    window.__g64.power();
    return { ok: true, powered: window.__g64.powered() };
  } catch (e) {
    return { ok: false, err: String(e) };
  }
});
console.log("POWER CALL", JSON.stringify(r));
await page.waitForTimeout(3000);
console.log("AFTER3", JSON.stringify(await page.evaluate(() => ({
  powered: window.__g64?.powered?.(),
  running: window.__g64?.running?.(),
  booting: window.__g64?.booting?.(),
  logs: window.__g64log,
  splash: !!document.querySelector(".g64-splash"),
}))));
await page.waitForTimeout(12000);
console.log("AFTER15", JSON.stringify(await page.evaluate(() => ({
  powered: window.__g64?.powered?.(),
  running: window.__g64?.running?.(),
  booting: window.__g64?.booting?.(),
  fs: window.__g64?.hasFs?.(),
  logs: window.__g64log,
}))));
await page.screenshot({ path: "/workspace/screenshots/dbg-power.png" });
await browser.close();
