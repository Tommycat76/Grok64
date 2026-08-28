import { chromium } from "playwright";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
page.on("pageerror", (e) => console.log("ERR", e.message.slice(0, 180)));
await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator(".g64-splash").waitFor({ timeout: 20000 });
await page.waitForFunction(() => typeof window.__g64?.power === "function", { timeout: 15000 });
await page.evaluate(() => window.__g64.power());
for (let i = 0; i < 40; i++) {
  const r = await page.evaluate(() => window.__g64?.running?.());
  if (r) break;
  await page.waitForTimeout(500);
}
await page.waitForTimeout(5000);
const d = await page.evaluate(() => {
  const root = document.getElementById("grok64-player");
  const canvases = [...(root?.querySelectorAll("canvas") || [])].map((c) => ({
    w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight, id: c.id, cls: c.className,
  }));
  const buttons = [...(root?.querySelectorAll("button, a") || [])].map((b) => ({
    t: (b.textContent || "").trim().slice(0, 60),
    cls: b.className,
    vis: getComputedStyle(b).display,
  }));
  const g = window.__g64;
  return {
    canvases,
    buttons,
    html: (root?.innerHTML || "").slice(0, 800),
    kids: root?.childElementCount,
    probe: g?.probe?.(),
    title: g?.title?.(),
    text: (root?.innerText || "").slice(0, 300),
  };
});
console.log(JSON.stringify(d, null, 2));
await browser.close();
