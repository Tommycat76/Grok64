import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2] || "http://127.0.0.1:8080/";
mkdirSync("/workspace/screenshots", { recursive: true });

const ONN_UA =
  "Mozilla/5.0 (Linux; Android 13; TBAF11 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Safari/537.36";

const browser = await chromium.launch({
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});

function box(n) {
  if (!n) return null;
  const r = n.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}

async function waitReady(page, ms = 28000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const st = await page.evaluate(() => ({
      fs: window.__g64?.hasFs?.(),
      running: window.__g64?.running?.(),
      powered: window.__g64?.powered?.(),
      booting: window.__g64?.booting?.(),
      splash: !!document.querySelector(".g64-splash"),
    }));
    if (st.fs && st.powered && !st.booting && !st.splash) return st;
    await page.waitForTimeout(300);
  }
  throw new Error("C64 did not reach READY");
}

const failures = [];

{
  const context = await browser.newContext({
    viewport: { width: 800, height: 1280 },
    userAgent: ONN_UA,
    hasTouch: true,
    isMobile: false,
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator(".g64-splash").waitFor({ timeout: 20000 });
  await page.waitForFunction(() => typeof window.__g64?.power === "function", { timeout: 15000 });
  await page.evaluate(() => window.__g64.power());
  await waitReady(page);

  const kb = page.locator('button[aria-label="Keyboard"]');
  if (await kb.count()) await kb.click();
  await page.waitForTimeout(400);

  const layout = await page.evaluate(() => {
    const app = document.querySelector(".g64-app");
    const bezel = document.querySelector(".g64-bezel");
    const screen = document.querySelector(".g64-screen");
    const canvas = document.querySelector("#grok64-player canvas");
    const b = (n) => {
      if (!n) return null;
      const r = n.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const bb = b(bezel);
    const sc = b(screen);
    const leftGap = sc && bb ? sc.x - bb.x : null;
    const rightGap = sc && bb ? bb.x + bb.w - (sc.x + sc.w) : null;
    return {
      device: app?.getAttribute("data-device"),
      kb: app?.getAttribute("data-kb"),
      bezel: bb,
      screen: sc,
      canvasCss: b(canvas),
      canvasBuf: canvas ? { w: canvas.width, h: canvas.height } : null,
      leftGap,
      rightGap,
      gapDelta: leftGap != null && rightGap != null ? Math.abs(leftGap - rightGap) : null,
      aspect: sc ? Math.round((sc.w / sc.h) * 100) / 100 : null,
    };
  });
  await page.screenshot({ path: "/workspace/screenshots/tablet-crt-kb.png", fullPage: false });

  if (layout.device !== "tablet") failures.push(`expected tablet, got ${layout.device}`);
  if (layout.canvasBuf && (layout.canvasBuf.w !== 384 || layout.canvasBuf.h !== 272)) {
    failures.push(`tablet canvas ${layout.canvasBuf.w}x${layout.canvasBuf.h} != 384x272`);
  }
  if (layout.gapDelta != null && layout.gapDelta > 24) {
    failures.push(`CRT not centered under log (L ${layout.leftGap} R ${layout.rightGap})`);
  }
  if (layout.screen && layout.bezel && layout.screen.w < 200) {
    failures.push(`CRT too narrow ${layout.screen.w}`);
  }
  console.log("tablet-crt", failures.length ? "FAIL" : "OK", JSON.stringify(layout));
  await context.close();
}

{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1",
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator(".g64-splash").waitFor({ timeout: 20000 });
  await page.waitForFunction(() => typeof window.__g64?.power === "function", { timeout: 15000 });
  await page.evaluate(() => window.__g64.power());
  await waitReady(page);

  const sd = page.locator("button.g64-chip-gate", { hasText: "SD2IEC" });
  if (await sd.count()) await sd.click();
  await page.waitForTimeout(200);

  const before = await page.evaluate(() => ({
    last: (window.__g64log || []).slice(-6),
    opts: window.__g64?.opts?.(),
  }));

  await page.evaluate(async () => {
    await window.__g64.load("/software/grok64-workbench.d64", "Burger_Time.d64");
  });
  await page.waitForTimeout(800);

  const after = await page.evaluate(() => ({
    last: (window.__g64log || []).filter((l) => /play \{|hot-swap/.test(String(l))).slice(-4),
    opts: window.__g64?.opts?.(),
    media: window.__g64?.media?.(),
    title: window.__g64?.title?.(),
    playMode: window.__g64?.playMode?.(),
  }));
  await page.screenshot({ path: "/workspace/screenshots/ios-play-attach.png" });

  const hot = after.last.join("\n");
  if (!/8_d64|iec":"1541"|"unit":8/.test(hot) && after.opts?.vice_work_disk !== "8_d64") {
    failures.push(`Play did not attach 8_d64 (logs=${hot} opts=${JSON.stringify(after.opts)})`);
  }
  console.log("ios-play", JSON.stringify({ beforeOpts: before.opts, after, failHint: failures.slice(-1) }));
  await context.close();
}

await browser.close();
if (failures.length) {
  console.error("FAIL", failures);
  process.exit(2);
}
console.log("PASS p0 play attach + tablet CRT");
process.exit(0);
