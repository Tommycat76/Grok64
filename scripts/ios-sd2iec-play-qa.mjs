#!/usr/bin/env node
/**
 * CriOS-ish regression: SD2IEC persisted ON at boot, then floppy Play.
 * Fails if Play hot-swaps on a live 8_fs core (DEVICE NOT PRESENT on real iPhone)
 * or if Autostart can race ahead of the 1541 remount/recycle.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2] || "http://127.0.0.1:8080/";
mkdirSync("/workspace/screenshots", { recursive: true });

const CRIOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/135.0.7049.53 Mobile/15E148 Safari/604.1";

const browser = await chromium.launch({
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent: CRIOS,
  hasTouch: true,
  isMobile: true,
});
await context.addInitScript(() => {
  const raw = localStorage.getItem("grok64-settings");
  let parsed = { state: {}, version: 10 };
  try {
    if (raw) parsed = JSON.parse(raw);
  } catch {
    /* seed */
  }
  parsed.state = { ...(parsed.state || {}), iecDrive: "sd2iec", iecUnit: 8 };
  parsed.version = parsed.version || 10;
  localStorage.setItem("grok64-settings", JSON.stringify(parsed));
});

const page = await context.newPage();
const failures = [];

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator(".g64-splash").waitFor({ timeout: 20000 });
await page.waitForFunction(() => typeof window.__g64?.power === "function", { timeout: 15000 });
await page.evaluate(() => window.__g64.power());

const readyT0 = Date.now();
while (Date.now() - readyT0 < 28000) {
  const st = await page.evaluate(() => ({
    fs: window.__g64?.hasFs?.(),
    running: window.__g64?.running?.(),
    powered: window.__g64?.powered?.(),
    booting: window.__g64?.booting?.(),
    splash: !!document.querySelector(".g64-splash"),
  }));
  if (st.fs && st.powered && !st.booting && !st.splash) break;
  await page.waitForTimeout(300);
}

// Slow IDBFS / delayed SD2IEC hook install on real CriOS.
await page.waitForTimeout(2800);

const before = await page.evaluate(() => ({
  sessionIec: window.__g64?.sessionIec?.(),
  workDisk: window.__g64?.workDisk?.(),
  opts: window.__g64?.opts?.(),
  playMode: window.__g64?.playMode?.(),
}));

if (before.sessionIec !== "sd2iec" && before.workDisk !== "8_fs") {
  failures.push(`expected SD2IEC/8_fs at boot, got session=${before.sessionIec} work=${before.workDisk}`);
}

let playSettled = false;
const playP = page.evaluate(async () => {
  await window.__g64.load("/software/grok64-workbench.d64", "paradroidalldri.d64");
});
playP.then(() => {
  playSettled = true;
});

// CriOS-ish: Play must not finish before recycle/mount is logged.
await page.waitForTimeout(350);
const mid = await page.evaluate(() => {
  const logs = (window.__g64log || []).map(String);
  return {
    recycle: logs.some((l) => /play-recycle/.test(l)),
    hot: logs.some((l) => /hot-swap/.test(l)),
    mount: logs.some((l) => /play-mount/.test(l)),
    coreStart: logs.some((l) => /core-start/.test(l) && /paradroid/i.test(l)),
    workDisk: window.__g64?.workDisk?.(),
    sessionIec: window.__g64?.sessionIec?.(),
  };
});
if (mid.hot && !mid.recycle) {
  failures.push("Play hot-swapped on SD2IEC boot instead of recycling the core");
}
if (playSettled && !mid.recycle && !mid.mount && !mid.coreStart) {
  failures.push("Play returned before mount/recycle — Autostart can race DEVICE NOT PRESENT");
}

await playP;

const t0 = Date.now();
let after = null;
while (Date.now() - t0 < 32000) {
  after = await page.evaluate(() => {
    const logs = (window.__g64log || []).map(String);
    return {
      recycle: logs.some((l) => /play-recycle/.test(l)),
      hot: logs.some((l) => /hot-swap/.test(l)),
      mount: logs.some((l) => /play-mount/.test(l)),
      play: logs.filter((l) => /play \{|play-recycle|hot-swap|play-mount|core-start/.test(l)).slice(-10),
      sessionIec: window.__g64?.sessionIec?.(),
      workDisk: window.__g64?.workDisk?.(),
      opts: window.__g64?.opts?.(),
      title: window.__g64?.title?.(),
      playMode: window.__g64?.playMode?.(),
    };
  });
  if (after.recycle && after.sessionIec === "1541" && (after.workDisk === "8_d64" || after.opts?.vice_work_disk === "8_d64")) {
    break;
  }
  await page.waitForTimeout(400);
}

await page.screenshot({ path: "/workspace/screenshots/ios-sd2iec-play.png" });

if (!after?.recycle) failures.push("missing play-recycle (floppy Play from SD2IEC must rebuild the core)");
if (after?.hot) failures.push("hot-swap ran on an SD2IEC/8_fs core");
if (after?.sessionIec !== "1541") failures.push(`session IEC ${after?.sessionIec}, want 1541`);
if (after?.workDisk !== "8_d64" && after?.opts?.vice_work_disk !== "8_d64") {
  failures.push(`work disk ${after?.workDisk || after?.opts?.vice_work_disk}, want 8_d64`);
}

console.log(
  JSON.stringify({
    before,
    mid,
    after,
    failures,
  }),
);

await browser.close();
if (failures.length) {
  console.error("FAIL", failures);
  process.exit(2);
}
console.log("PASS ios sd2iec floppy play recycle");
process.exit(0);
