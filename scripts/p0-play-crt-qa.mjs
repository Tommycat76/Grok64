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
  // Tom's real phone: SD2IEC persisted ON before the core boots (8_fs).
  await context.addInitScript(() => {
    const raw = localStorage.getItem("grok64-settings");
    let parsed = { state: {}, version: 10 };
    try {
      if (raw) parsed = JSON.parse(raw);
    } catch {
      /* seed fresh */
    }
    parsed.state = { ...(parsed.state || {}), iecDrive: "sd2iec", iecUnit: 8 };
    parsed.version = parsed.version || 10;
    localStorage.setItem("grok64-settings", JSON.stringify(parsed));
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.locator(".g64-splash").waitFor({ timeout: 20000 });
  await page.waitForFunction(() => typeof window.__g64?.power === "function", { timeout: 15000 });
  await page.evaluate(() => window.__g64.power());
  await waitReady(page);
  // CriOS extras (SD2IEC hooks) land after READY — #33 raced ahead of this.
  await page.waitForTimeout(2600);

  const before = await page.evaluate(() => ({
    last: (window.__g64log || []).slice(-6),
    opts: window.__g64?.opts?.(),
    sessionIec: window.__g64?.sessionIec?.(),
    workDisk: window.__g64?.workDisk?.(),
  }));

  const playP = page.evaluate(async () => {
    await window.__g64.load("/software/grok64-workbench.d64", "paradroidalldri.d64");
  });
  // Must not treat Play as done before the mount/recycle settles.
  await page.waitForTimeout(400);
  const raced = await page.evaluate(() => {
    const logs = (window.__g64log || []).map(String);
    const recycle = logs.some((l) => /play-recycle/.test(l));
    const hot = logs.some((l) => /hot-swap/.test(l));
    const mount = logs.some((l) => /play-mount/.test(l));
    const start = logs.some((l) => /core-start/.test(l) && /paradroid/i.test(l));
    return { recycle, hot, mount, start, playMode: window.__g64?.playMode?.() };
  });
  if (raced.hot && !raced.recycle && (before.workDisk === "8_fs" || before.sessionIec === "sd2iec")) {
    failures.push("Play hot-swapped on live SD2IEC/8_fs before recycle (CriOS race)");
  }
  await playP;

  const t0 = Date.now();
  let after = null;
  while (Date.now() - t0 < 28000) {
    after = await page.evaluate(() => ({
      last: (window.__g64log || []).filter((l) => /play \{|hot-swap|play-recycle|play-mount|core-start/.test(String(l))).slice(-8),
      opts: window.__g64?.opts?.(),
      media: window.__g64?.media?.(),
      title: window.__g64?.title?.(),
      playMode: window.__g64?.playMode?.(),
      sessionIec: window.__g64?.sessionIec?.(),
      workDisk: window.__g64?.workDisk?.(),
    }));
    const joined = (after.last || []).join("\n");
    const disk = after.workDisk === "8_d64" || after.opts?.vice_work_disk === "8_d64" || /8_d64/.test(joined);
    if (after.sessionIec === "1541" && disk && (/play-recycle|core-start|hot-swap/.test(joined))) break;
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: "/workspace/screenshots/ios-play-attach.png" });

  const hot = (after?.last || []).join("\n");
  if (/hot-swap/.test(hot) && !/play-recycle/.test(hot) && (before.workDisk === "8_fs" || before.sessionIec === "sd2iec")) {
    failures.push(`Play hot-swapped instead of recycling 8_fs (logs=${hot})`);
  }
  if (after?.sessionIec !== "1541") {
    failures.push(`session IEC after Play is ${after?.sessionIec}, want 1541`);
  }
  if (after?.workDisk !== "8_d64" && after?.opts?.vice_work_disk !== "8_d64" && !/8_d64/.test(hot)) {
    failures.push(`Play did not attach 8_d64 (logs=${hot} opts=${JSON.stringify(after?.opts)} work=${after?.workDisk})`);
  }
  console.log("ios-play", JSON.stringify({ before, after, raced, failHint: failures.slice(-1) }));
  await context.close();
}

await browser.close();
if (failures.length) {
  console.error("FAIL", failures);
  process.exit(2);
}
console.log("PASS p0 play attach + tablet CRT");
process.exit(0);
