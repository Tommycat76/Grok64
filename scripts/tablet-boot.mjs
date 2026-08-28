import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const url = process.argv[2] || "http://127.0.0.1:8080/";
mkdirSync("/workspace/screenshots", { recursive: true });

const ONN_UA =
  "Mozilla/5.0 (Linux; Android 13; TBAF11 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Safari/537.36";
const ANDROID_MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const cases = [
  { name: "onn-1200", ua: ONN_UA, viewport: { width: 1200, height: 2000 }, hasTouch: true, isMobile: false },
  { name: "onn-preview", ua: ONN_UA, viewport: { width: 800, height: 720 }, hasTouch: true, isMobile: false },
  { name: "onn-land", ua: ONN_UA, viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: false },
  { name: "android-tab", ua: ANDROID_MOBILE_UA, viewport: { width: 1200, height: 2000 }, hasTouch: true, isMobile: true },
];

const browser = await chromium.launch({
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});

let failed = 0;
for (const c of cases) {
  const context = await browser.newContext({
    viewport: c.viewport,
    userAgent: c.ua,
    hasTouch: c.hasTouch,
    isMobile: c.isMobile,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 220)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text().slice(0, 180)}`);
  });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator(".g64-splash").waitFor({ timeout: 20000 });
  await page.waitForFunction(() => typeof window.__g64?.power === "function", { timeout: 15000 });
  await page.screenshot({ path: `/workspace/screenshots/boot-${c.name}-splash.png` });
  await page.evaluate(() => window.__g64.power());
  const t0 = Date.now();
  let st = {};
  while (Date.now() - t0 < 28000) {
    st = await page.evaluate(() => {
      const el = document.getElementById("grok64-player");
      const canvas = el?.querySelector("canvas");
      const app = document.querySelector(".g64-app");
      const stage = document.querySelector(".g64-stage");
      const screen = document.querySelector(".g64-screen");
      const box = (n) => {
        if (!n) return null;
        const r = n.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), t: Math.round(r.top) };
      };
      return {
        fs: window.__g64?.hasFs?.(),
        running: window.__g64?.running?.(),
        powered: window.__g64?.powered?.(),
        booting: window.__g64?.booting?.(),
        lock: window.__g64?.playLock?.(),
        device: app?.getAttribute("data-device"),
        player: box(el),
        canvasCss: box(canvas),
        canvasBuf: canvas ? { w: canvas.width, h: canvas.height } : null,
        stage: box(stage),
        screen: box(screen),
        splash: !!document.querySelector(".g64-splash"),
        last: (window.__g64log || []).slice(-8),
      };
    });
    if (st.fs && st.running && st.powered && !st.booting) break;
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: `/workspace/screenshots/boot-${c.name}-after.png` });
  const ok = st.fs && st.powered && !st.splash && (st.running || st.player?.h > 64);
  console.log(
    c.name,
    ok ? "OK" : "FAIL",
    JSON.stringify({
      device: st.device,
      powered: st.powered,
      running: st.running,
      booting: st.booting,
      fs: st.fs,
      splash: st.splash,
      player: st.player,
      canvasCss: st.canvasCss,
      canvasBuf: st.canvasBuf,
      stage: st.stage,
      screen: st.screen,
      errors: errors.slice(0, 6),
      last: st.last,
    }),
  );
  if (!ok) failed += 1;
  await context.close();
}

await browser.close();
process.exit(failed ? 2 : 0);
