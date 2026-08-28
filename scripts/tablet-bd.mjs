import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const url = process.argv[2] || "http://127.0.0.1:8080/";
mkdirSync("/workspace/screenshots", { recursive: true });

const ONN_UA =
  "Mozilla/5.0 (Linux; Android 13; TBAF11 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Safari/537.36";

const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1200, height: 2000 },
  isMobile: false,
  hasTouch: true,
  userAgent: ONN_UA,
});
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 180)));

function analyze(path) {
  const out = execFileSync(
    "python3",
    [
      "-c",
      `
from PIL import Image
im=Image.open('${path}').convert('RGB')
px=list(im.getdata())
n=len(px)
r=sum(p[0] for p in px)/n
g=sum(p[1] for p in px)/n
b=sum(p[2] for p in px)/n
lum=(r+g+b)/3
print(f'{r:.1f} {g:.1f} {b:.1f} {lum:.1f}')
`,
    ],
    { encoding: "utf8" },
  ).trim();
  const [r, g, b, lum] = out.split(" ").map(Number);
  let color = "other";
  if (lum < 12) color = "black";
  else if (r > 200 && g > 200 && b > 200) color = "white";
  else if (g > r + 20 && g > b) color = "green";
  else if (r > 140 && g > 140 && b < 140 && lum > 80) color = "yellow";
  return { r, g, b, lum, color };
}

async function canvasShot(name) {
  const grabbed = await page.evaluate(() => window.__g64?.canvasShot?.());
  const path = `/workspace/screenshots/${name}.png`;
  if (grabbed?.b64) writeFileSync(path, Buffer.from(grabbed.b64, "base64"));
  else await page.screenshot({ path });
  const info = analyze(path);
  console.log(name, info.color, JSON.stringify(info));
  return info;
}

async function waitReady(ms = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const st = await page.evaluate(() => ({
      fs: window.__g64?.hasFs?.(),
      running: window.__g64?.running?.(),
      powered: window.__g64?.powered?.(),
      booting: window.__g64?.booting?.(),
      lock: window.__g64?.playLock?.(),
    }));
    if (st.fs && st.running && st.powered && !st.booting && !st.lock) return st;
    await page.waitForTimeout(250);
  }
  return page.evaluate(() => ({
    fs: window.__g64?.hasFs?.(),
    running: window.__g64?.running?.(),
    powered: window.__g64?.powered?.(),
    booting: window.__g64?.booting?.(),
    lock: window.__g64?.playLock?.(),
  }));
}

async function fireHold(ms = 400) {
  await page.evaluate(() => window.__g64?.fire?.(true));
  await page.waitForTimeout(ms);
}

async function fireUp() {
  await page.evaluate(() => window.__g64?.fire?.(false));
}

function overlap(a, b) {
  return !(a.bottom <= b.top + 2 || b.bottom <= a.top + 2 || a.right <= b.left + 2 || b.right <= a.left + 2);
}

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator(".g64-splash").waitFor({ timeout: 20000 });
await page.waitForFunction(() => typeof window.__g64?.power === "function", { timeout: 15000 });
await page.evaluate(() => window.__g64.power());
const powered = await waitReady(28000);
console.log("POWER", JSON.stringify(powered));
if (!powered.fs) {
  await browser.close();
  process.exit(2);
}

const device = await page.evaluate(() => document.querySelector(".g64-app")?.getAttribute("data-device"));
console.log("DEVICE", device);
if (device !== "tablet") {
  console.log("FAIL expected tablet");
  await browser.close();
  process.exit(2);
}

await page.locator('button[aria-label="Keyboard"]').first().click();
await page.waitForTimeout(400);
await page.screenshot({ path: "/workspace/screenshots/tablet-kb-open.png", fullPage: true });

const boxes = await page.evaluate(() => {
  const r = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { top: b.top, left: b.left, right: b.right, bottom: b.bottom, w: b.width, h: b.height };
  };
  return {
    device: document.querySelector(".g64-app")?.getAttribute("data-device"),
    kb: document.querySelector(".g64-app")?.getAttribute("data-kb"),
    stick: r(".g64-stick"),
    fire: r(".g64-fire"),
    keyboard: r(".g64-kb"),
    bezel: r(".g64-bezel"),
    stage: r(".g64-stage"),
  };
});
console.log("BOXES", JSON.stringify(boxes));

const kbCoversStick = boxes.stick && boxes.keyboard && overlap(boxes.stick, boxes.keyboard);
const kbCoversFire = boxes.fire && boxes.keyboard && overlap(boxes.fire, boxes.keyboard);
const stickBelowBezel = boxes.stick && boxes.bezel && boxes.stick.top >= boxes.bezel.bottom - 4;
console.log("LAYOUT", JSON.stringify({ kbCoversStick, kbCoversFire, stickBelowBezel }));

if (kbCoversStick || kbCoversFire) {
  console.log("FAIL keyboard covers joystick");
  await browser.close();
  process.exit(2);
}
if (!stickBelowBezel) {
  console.log("FAIL stick should sit under the screen on tablet");
  await browser.close();
  process.exit(2);
}

await page.locator('button[aria-label="Keyboard"]').first().click();
await page.waitForTimeout(200);

await page.evaluate(async () => {
  await window.__g64?.load?.("/software/ports.prg", "Boulder Dash.prg");
});
await waitReady(20000);
await page.waitForTimeout(600);
const autoPort = await page.evaluate(() => window.__g64?.joyPort?.());
console.log("AUTOPLUG", autoPort);
const bdIdle = await canvasShot("tablet-bdport-idle");
await fireHold(500);
const bdFire = await canvasShot("tablet-bdport-fire");
await fireUp();
console.log("BDPORT", bdIdle.color, "->", bdFire.color, "port", autoPort);

await page.evaluate(async () => {
  await window.__g64?.load?.("/software/byte-hopper.prg", "byte-hopper.prg");
});
await waitReady(20000);
await page.waitForTimeout(500);
const hopPort = await page.evaluate(() => window.__g64?.joyPort?.());
await fireHold(500);
const hopGo = await canvasShot("tablet-hopper-go");
await fireUp();
console.log("HOPPER", hopGo.color, "port", hopPort);

await page.locator('button[aria-label="Software"]').first().click();
await page.locator(".g64-sheet").waitFor({ state: "visible", timeout: 8000 });
const search = page.locator(".g64-search input");
await search.fill("Boulder Dash");
await page.locator('.g64-search button[type="submit"]').click();
await page.waitForTimeout(3500);
await page.screenshot({ path: "/workspace/screenshots/tablet-bd-catalog.png" });
const firstHit = await page.locator(".g64-hit strong").first().innerText().catch(() => "");
console.log("FIRSTHIT", firstHit);

const splash = await page.evaluate(() => !!document.querySelector(".g64-splash"));
await browser.close();

let fail = 0;
if (autoPort !== 1) {
  console.log("FAIL Boulder Dash should auto-plug port 1");
  fail = 1;
}
if (bdFire.color !== "yellow" || bdFire.color === "white") {
  console.log("FAIL auto-plugged BD fire should be yellow (port 1 only)");
  fail = 1;
}
if (hopPort !== 2) {
  console.log("FAIL hopper should return to port 2");
  fail = 1;
}
if (hopGo.color !== "green") {
  console.log("FAIL hopper fire should be green");
  fail = 1;
}
if (/construction|kit|awally/i.test(firstHit)) {
  console.log("FAIL catalog first hit is a construction kit / A Wally disk");
  fail = 1;
}
if (splash) {
  console.log("FAIL reboot");
  fail = 1;
}
if (fail) process.exit(2);
console.log("PASS tablet layout + BD port 1 autoplug + cleaner catalog");
process.exit(0);
