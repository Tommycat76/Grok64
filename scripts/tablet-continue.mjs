import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const url = process.argv[2] || "http://127.0.0.1:8080/";
mkdirSync("/workspace/screenshots", { recursive: true });

function analyzeBuf(buf, path) {
  writeFileSync(path, buf);
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
# center crop
w,h=im.size
cx,cy=w//2,h//2
crop=im.crop((cx-w//6, cy-h//6, cx+w//6, cy+h//6))
cp=list(crop.getdata())
cn=len(cp)
cr=sum(p[0] for p in cp)/cn
cg=sum(p[1] for p in cp)/cn
cb=sum(p[2] for p in cp)/cn
print(f'{im.size[0]} {im.size[1]} {r:.1f} {g:.1f} {b:.1f} {lum:.1f} {cr:.1f} {cg:.1f} {cb:.1f}')
`,
    ],
    { encoding: "utf8" },
  ).trim();
  const [w, h, r, g, b, lum, cr, cg, cb] = out.split(" ").map(Number);
  return { w, h, r, g, b, lum, cr, cg, cb };
}

const browser = await chromium.launch({
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const context = await browser.newContext({
  viewport: { width: 1200, height: 2000 },
  userAgent:
    "Mozilla/5.0 (Linux; Android 13; TBAF11 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Safari/537.36",
  hasTouch: true,
  isMobile: false,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator(".g64-splash").waitFor({ timeout: 20000 });
await page.waitForFunction(() => typeof window.__g64?.power === "function", { timeout: 15000 });
await page.evaluate(() => window.__g64.power());

const t0 = Date.now();
let st = {};
while (Date.now() - t0 < 28000) {
  st = await page.evaluate(() => ({
    fs: window.__g64?.hasFs?.(),
    running: window.__g64?.running?.(),
    powered: window.__g64?.powered?.(),
    booting: window.__g64?.booting?.(),
    splash: !!document.querySelector(".g64-splash"),
    last: (window.__g64log || []).slice(-6),
  }));
  if (st.fs && st.running && st.powered && !st.booting && !st.splash) break;
  await page.waitForTimeout(300);
}
console.log("BOOT", JSON.stringify({ ...st, errors: errors.slice(0, 4) }));

const canvasB64 = await page.evaluate(() => window.__g64?.canvasShot?.());
if (canvasB64?.b64) {
  const info = analyzeBuf(Buffer.from(canvasB64.b64, "base64"), "/workspace/screenshots/cont-basic-canvas.png");
  console.log("CANVAS", JSON.stringify(info));
} else {
  console.log("CANVAS none");
}
const vice = await page.evaluate(async () => window.__g64?.shot?.());
if (vice?.b64) {
  const info = analyzeBuf(Buffer.from(vice.b64, "base64"), `/workspace/screenshots/cont-basic-vice-${vice.src}.png`);
  console.log("VICE", vice.src, vice.bytes, JSON.stringify(info));
} else {
  console.log("VICE none");
}

await page.locator('button[aria-label="Keyboard"]').click();
await page.waitForTimeout(400);
const layout = await page.evaluate(() => {
  const box = (sel) => {
    const n = document.querySelector(sel);
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const stick = box(".g64-stick");
  const fire = box(".g64-fire");
  const kb = box(".g64-kb");
  const bezel = box(".g64-bezel");
  const overlap = (a, b) => a && b && !(a.b <= b.t + 2 || b.b <= a.t + 2 || a.r <= b.l + 2 || b.r <= a.l + 2);
  return {
    device: document.querySelector(".g64-app")?.getAttribute("data-device"),
    stick,
    fire,
    kb,
    bezel,
    kbCoversStick: overlap(stick, kb),
    kbCoversFire: overlap(fire, kb),
    stickBelowBezel: stick && bezel ? stick.t >= bezel.b - 8 : false,
  };
});
await page.screenshot({ path: "/workspace/screenshots/cont-tablet-kb.png" });
console.log("LAYOUT", JSON.stringify(layout));

await page.evaluate(async () => {
  await window.__g64.load("/software/byte-hopper.prg", "byte-hopper.prg");
});
await page.waitForFunction(() => window.__g64?.hasFs?.() && !window.__g64?.booting?.() && !window.__g64?.playLock?.(), { timeout: 25000 });
await page.waitForTimeout(700);
await page.evaluate(() => window.__g64.fire(true));
await page.waitForTimeout(500);
const hop = await page.evaluate(() => window.__g64?.canvasShot?.());
await page.evaluate(() => window.__g64.fire(false));
if (hop?.b64) {
  const info = analyzeBuf(Buffer.from(hop.b64, "base64"), "/workspace/screenshots/cont-hopper-fire.png");
  console.log("HOPPER", JSON.stringify(info));
} else console.log("HOPPER none");

await browser.close();

const fail = [];
if (!st.fs || st.splash) fail.push("boot");
if (layout.kbCoversStick || layout.kbCoversFire) fail.push("kb-overlap");
if (!layout.stickBelowBezel) fail.push("stick-not-docked");
console.log(fail.length ? `FAIL ${fail.join(",")}` : "PASS");
process.exit(fail.length ? 2 : 0);
