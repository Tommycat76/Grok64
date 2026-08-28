import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2] || "http://127.0.0.1:8080/";
mkdirSync("/workspace/screenshots", { recursive: true });

const ONN_UA =
  "Mozilla/5.0 (Linux; Android 13; TBAF11 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Safari/537.36";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

const cases = [
  {
    name: "onn-landscape",
    timezoneId: "America/Denver",
    locale: "en-US",
    userAgent: ONN_UA,
    viewport: { width: 1280, height: 800 },
    hasTouch: true,
    isMobile: false,
    expect: { device: "tablet", standard: "pal", core: "fast", os: "android" },
  },
  {
    name: "onn-portrait",
    timezoneId: "America/Chicago",
    locale: "en-US",
    userAgent: ONN_UA,
    viewport: { width: 800, height: 1280 },
    hasTouch: true,
    isMobile: false,
    expect: { device: "tablet", standard: "pal", core: "fast", os: "android" },
  },
  {
    name: "iphone",
    timezoneId: "America/Denver",
    locale: "en-US",
    userAgent: IPHONE_UA,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    expect: { device: "phone", standard: "pal", core: "fast", os: "ios" },
  },
  {
    name: "uk-desktop",
    timezoneId: "Europe/London",
    locale: "en-GB",
    viewport: { width: 1280, height: 800 },
    hasTouch: false,
    isMobile: false,
    expect: { device: "desktop", standard: "pal", core: "accurate", os: "other" },
  },
];

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const results = [];

for (const c of cases) {
  const context = await browser.newContext({
    timezoneId: c.timezoneId,
    locale: c.locale,
    userAgent: c.userAgent,
    viewport: c.viewport,
    hasTouch: c.hasTouch,
    isMobile: c.isMobile,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(400);
  const info = await page.evaluate(() => {
    const root = document.querySelector(".g64-app");
    const extra = [...document.querySelectorAll(".g64-iconbtn.extra")];
    const extraVisible = extra.some((el) => getComputedStyle(el).display !== "none");
    return {
      device: root?.getAttribute("data-device"),
      os: root?.getAttribute("data-os"),
      standard: root?.getAttribute("data-standard"),
      core: root?.getAttribute("data-core"),
      detect: document.querySelector(".g64-detect")?.textContent?.trim() ?? "",
      extraVisible,
    };
  });
  const shot = `/workspace/screenshots/detect-${c.name}.png`;
  await page.screenshot({ path: shot, fullPage: true });

  await page.locator(".g64-power").click();
  await page.waitForTimeout(800);
  const powered = await page.evaluate(() => {
    const root = document.querySelector(".g64-app");
    const extra = [...document.querySelectorAll(".g64-iconbtn.extra")];
    const stick = document.querySelector(".g64-stick");
    const fire = document.querySelector(".g64-fire");
    const stage = document.querySelector(".g64-stage");
    return {
      device: root?.getAttribute("data-device"),
      chip: document.querySelector(".g64-chip")?.textContent?.trim() ?? "",
      extraVisible: extra.some((el) => getComputedStyle(el).display !== "none"),
      extraCount: extra.length,
      stick: stick ? Math.round(stick.getBoundingClientRect().width) : 0,
      fire: fire ? Math.round(fire.getBoundingClientRect().width) : 0,
      stageDir: stage ? getComputedStyle(stage).flexDirection : "",
    };
  });
  const poweredShot = `/workspace/screenshots/detect-${c.name}-on.png`;
  await page.screenshot({ path: poweredShot, fullPage: true });

  const okDevice = info.device === c.expect.device;
  const okStd = info.standard === c.expect.standard;
  const okCore = info.core === c.expect.core;
  const okOs = info.os === c.expect.os;
  results.push({
    name: c.name,
    ok: okDevice && okStd && okCore && okOs && errors.length === 0,
    info,
    powered,
    errors,
    expect: c.expect,
  });
  await context.close();
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
if (results.some((r) => !r.ok)) process.exit(1);
