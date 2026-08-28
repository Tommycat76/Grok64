import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const url = process.argv[2] || "http://127.0.0.1:8080/";
mkdirSync("/workspace/screenshots", { recursive: true });

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
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
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

await page.evaluate(async () => {
  await window.__g64?.load?.("/software/byte-hopper.prg", "byte-hopper.prg");
});
await waitReady(20000);
await page.waitForTimeout(600);
const hopTitle = await canvasShot("assign-hopper-title");
await fireHold(500);
const hopGo = await canvasShot("assign-hopper-go");
await fireUp();
const hopperStarted = hopTitle.color === "black" && hopGo.color === "green";
console.log("HOPPER", hopperStarted ? "started" : "FAIL", hopTitle.color, "->", hopGo.color);

await page.evaluate(async () => {
  await window.__g64?.load?.("/software/ports.prg", "ports.prg");
});
await waitReady(20000);
await page.waitForTimeout(800);
const idle = await canvasShot("assign-p2-idle");
await fireHold(500);
const p2 = await canvasShot("assign-p2-fire");
await fireUp();
await page.waitForTimeout(300);
const p2up = await canvasShot("assign-p2-up");

const portBtn = page.locator(".g64-port").first();
await portBtn.click({ force: true });
await page.waitForTimeout(400);
await fireHold(500);
const p1 = await canvasShot("assign-p1-fire");
await fireUp();
await page.waitForTimeout(300);
const p1up = await canvasShot("assign-p1-up");

const splash = await page.evaluate(() => !!document.querySelector(".g64-splash"));
console.log("ASSIGN", JSON.stringify({
  hopperStarted,
  idle: idle.color,
  p2: p2.color,
  p2up: p2up.color,
  p1: p1.color,
  p1up: p1up.color,
  splash,
}));

await browser.close();

if (!hopperStarted) {
  console.log("FAIL hopper");
  process.exit(2);
}
if (idle.color !== "black" || p2up.color !== "black" || p1up.color !== "black") {
  console.log("FAIL idle should be black");
  process.exit(2);
}
if (p2.color === "white" || p1.color === "white") {
  console.log("FAIL fire hit both ports");
  process.exit(2);
}
if (p2.color !== "green") {
  console.log("FAIL assigned P2 fire should be green");
  process.exit(2);
}
if (p1.color !== "yellow") {
  console.log("FAIL swapped P1 fire should be yellow");
  process.exit(2);
}
if (splash) {
  console.log("FAIL reboot");
  process.exit(2);
}
console.log("PASS one joystick on the assigned port");
process.exit(0);
