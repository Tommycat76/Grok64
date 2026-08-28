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
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1",
});
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 180)));

const logs = () => page.evaluate(() => window.__g64log ?? []);
const count = (hay, re) => hay.filter((l) => re.test(String(l))).length;

function analyze(path) {
  const out = execFileSync(
    "python3",
    [
      "-c",
      `
from PIL import Image
im=Image.open('${path}').convert('RGB')
w,h=im.size
px=list(im.getdata())
n=len(px)
r=sum(p[0] for p in px)/n
g=sum(p[1] for p in px)/n
b=sum(p[2] for p in px)/n
lum=(r+g+b)/3
uniq=len({(p[0]//16,p[1]//16,p[2]//16) for p in px})
# 8x8 hash
im2=im.resize((8,8))
hsh=''.join('1' if (p[0]+p[1]+p[2])>240 else '0' for p in im2.getdata())
print(f'{w} {h} {r:.1f} {g:.1f} {b:.1f} {lum:.1f} {uniq} {hsh} {n}')
`,
    ],
    { encoding: "utf8" },
  ).trim();
  const [w, h, r, g, b, lum, uniq, hsh, n] = out.split(" ");
  return {
    w: +w,
    h: +h,
    r: +r,
    g: +g,
    b: +b,
    lum: +lum,
    uniq: +uniq,
    hash: hsh,
    n: +n,
  };
}

async function saveShot(name) {
  const path = `/workspace/screenshots/${name}.png`;
  await page.screenshot({ path, timeout: 8000 });
  await page.locator(".g64-bezel").screenshot({ path: `/workspace/screenshots/${name}-bezel.png` }).catch(() => null);

  const grabbed = await page.evaluate(async () => {
    const canvas = window.__g64?.canvasShot?.() ?? null;
    let vice = null;
    try {
      vice = await window.__g64?.shot?.();
    } catch {
      vice = null;
    }
    return { canvas, vice };
  });

  const candidates = [];
  if (grabbed?.canvas?.b64) {
    const p = `/workspace/screenshots/${name}-canvas.png`;
    writeFileSync(p, Buffer.from(grabbed.canvas.b64, "base64"));
    candidates.push({ path: p, src: "canvas", bytes: grabbed.canvas.bytes || 0, ...analyze(p) });
  }
  if (grabbed?.vice?.b64 && grabbed.vice.src !== "canvas") {
    const p = `/workspace/screenshots/${name}-vice.png`;
    writeFileSync(p, Buffer.from(grabbed.vice.b64, "base64"));
    candidates.push({ path: p, src: grabbed.vice.src || "vice", bytes: grabbed.vice.bytes || 0, ...analyze(p) });
  }
  if (!candidates.length) {
    const info = analyze(path);
    console.log(name, "page-only", JSON.stringify(info));
    return { path, src: "page", bytes: 0, ...info };
  }
  candidates.sort((a, b) => {
    const aCanvas = a.src === "canvas" ? 1 : 0;
    const bCanvas = b.src === "canvas" ? 1 : 0;
    if (aCanvas !== bCanvas && (a.uniq >= 2 || b.uniq >= 2)) return bCanvas - aCanvas;
    return b.uniq - a.uniq || b.lum - a.lum;
  });
  const best = candidates[0];
  console.log(name, best.src, JSON.stringify(best));
  return best;
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
    await page.waitForTimeout(300);
  }
  return page.evaluate(() => ({
    fs: window.__g64?.hasFs?.(),
    running: window.__g64?.running?.(),
    powered: window.__g64?.powered?.(),
    booting: window.__g64?.booting?.(),
    lock: window.__g64?.playLock?.(),
  }));
}

function aliveFrame(fr) {
  if (!fr) return false;
  if (fr.src === "canvas" && fr.uniq >= 2 && fr.lum >= 0) return fr.uniq >= 2;
  return fr.uniq >= 4 && fr.lum > 4 && fr.lum < 250;
}

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator(".g64-splash").waitFor({ timeout: 20000 });
await page.waitForFunction(() => typeof window.__g64?.power === "function", { timeout: 15000 });
await page.waitForTimeout(400);
await page.evaluate(() => window.__g64.power());
if (!(await page.evaluate(() => window.__g64?.powered?.()))) {
  await page.locator(".g64-splash").click({ force: true }).catch(() => undefined);
}
const powered = await waitReady(28000);
console.log("POWER", JSON.stringify(powered));
if (!powered.fs) {
  console.log("FAIL no fs", (await logs()).slice(-12));
  await browser.close();
  process.exit(2);
}
const basic = await saveShot("play-basic-frame");

await page.evaluate(async () => {
  await window.__g64?.load?.("/software/byte-hopper.prg", "byte-hopper.prg");
});
for (let i = 0; i < 40; i++) {
  const t = await page.evaluate(() => window.__g64?.title?.());
  if (/hopper/i.test(String(t))) break;
  await page.waitForTimeout(250);
}
const hopReady = await waitReady(20000);
console.log("HOPPER READY", JSON.stringify({ ...hopReady, title: await page.evaluate(() => window.__g64?.title?.()) }));
await page.waitForTimeout(800);
const hopTitle = await saveShot("play-hopper-title");

async function tapFire() {
  const btn = page.locator(".g64-fire");
  if (await btn.count()) {
    await btn.dispatchEvent("pointerdown");
    await page.waitForTimeout(500);
    await btn.dispatchEvent("pointerup");
  }
  await page.evaluate(() => window.__g64?.fire?.(true));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__g64?.fire?.(false));
}

const hopLogsBefore = await logs();
const hopBootsBefore = count(hopLogsBefore, /boot-begin|power-on|kickAutostart|restart-ok|hot-swap/);
await tapFire();
await page.waitForTimeout(1600);
const hopGo = await saveShot("play-hopper-go");
const hopLogsAfter = await logs();
const hopRestart = count(hopLogsAfter, /boot-begin|power-on|kickAutostart|restart-ok|hot-swap/) > hopBootsBefore;
const hopperStarted =
  hopGo.hash !== hopTitle.hash &&
  (hopGo.g - hopTitle.g > 6 || Math.abs(hopGo.lum - hopTitle.lum) > 8);
console.log("HOPPER FIRE", JSON.stringify({ hopperStarted, hopRestart, splash: await page.evaluate(() => !!document.querySelector(".g64-splash")) }));

await page.locator('button[aria-label="Software"]').first().click();
await page.locator(".g64-sheet").waitFor({ state: "visible", timeout: 8000 });
const search = page.locator(".g64-search input");
await search.fill("Boulder Dash");
await page.locator('.g64-search button[type="submit"]').click();
await page.waitForTimeout(2800);
await page.screenshot({ path: "/workspace/screenshots/play-bd-catalog.png" });

const playHit = page.locator(".g64-hit").filter({ hasText: /boulder/i }).first();
if (!(await playHit.count())) {
  console.log("NO BD HITS", (await page.locator(".g64-sheet").innerText()).slice(0, 400));
  await browser.close();
  process.exit(3);
}
await playHit.locator('button[aria-label^="Play"]').click();
console.log("clicked BD play");

for (let i = 0; i < 90; i++) {
  const t = String(await page.evaluate(() => window.__g64?.title?.() || ""));
  if (/boulder/i.test(t)) break;
  await page.waitForTimeout(400);
}
const bdReady = await waitReady(25000);
console.log("BD READY", JSON.stringify({
  ...bdReady,
  title: await page.evaluate(() => window.__g64?.title?.()),
  sheet: await page.locator(".g64-sheet").isVisible().catch(() => null),
}));
await page.keyboard.press("Escape").catch(() => undefined);
await page.locator(".g64-sheet").waitFor({ state: "hidden", timeout: 4000 }).catch(() => undefined);
await page.waitForTimeout(2500);
const bdTitle = await saveShot("play-bd-title");

const before = await logs();
const bootsBefore = count(before, /boot-begin|power-on|kickAutostart|restart-ok/);
const hotBefore = count(before, /hot-swap/);
console.log("PREFIRE", JSON.stringify({
  title: await page.evaluate(() => window.__g64?.title?.()),
  splash: await page.evaluate(() => !!document.querySelector(".g64-splash")),
  running: await page.evaluate(() => window.__g64?.running?.()),
  booting: await page.evaluate(() => window.__g64?.booting?.()),
  lock: await page.evaluate(() => window.__g64?.playLock?.()),
  bootsBefore,
  last: before.slice(-8),
}));

await tapFire();
await page.waitForTimeout(2200);
const bdGo = await saveShot("play-bd-go");
const after1 = await logs();
console.log("AFTER1", JSON.stringify({
  title: await page.evaluate(() => window.__g64?.title?.()),
  splash: await page.evaluate(() => !!document.querySelector(".g64-splash")),
  running: await page.evaluate(() => window.__g64?.running?.()),
  booting: await page.evaluate(() => window.__g64?.booting?.()),
  lock: await page.evaluate(() => window.__g64?.playLock?.()),
  boots: count(after1, /boot-begin|power-on|kickAutostart|restart-ok/),
  blocked: count(after1, /restart-blocked|fire-blocked/),
  fires: count(after1, /FIRE down/),
  last: after1.slice(-12),
}));

await page.waitForTimeout(1800);
const bdStay = await saveShot("play-bd-stay");
await tapFire();
await page.waitForTimeout(1500);
const bdSecond = await saveShot("play-bd-second");
const after2 = await logs();
const splash = await page.evaluate(() => !!document.querySelector(".g64-splash"));
const boots2 = count(after2, /boot-begin|power-on|kickAutostart|restart-ok/);
const hot2 = count(after2, /hot-swap/);

const started = bdGo.hash !== bdTitle.hash && Math.abs(bdGo.lum - bdTitle.lum) + Math.abs(bdGo.r - bdTitle.r) + Math.abs(bdGo.g - bdTitle.g) > 12;
const bouncedToTitle = bdStay.hash === bdTitle.hash && bdGo.hash !== bdTitle.hash;
const rebooted = splash || boots2 > bootsBefore || hot2 > hotBefore + 0;
const frameOk = aliveFrame(bdTitle) && aliveFrame(bdGo);

console.log("RESULT", JSON.stringify({
  hopperStarted,
  hopRestart,
  started,
  bouncedToTitle,
  rebooted,
  frameOk,
  splash,
  bootsBefore,
  boots2,
  titleHash: bdTitle.hash,
  goHash: bdGo.hash,
  stayHash: bdStay.hash,
  secondHash: bdSecond.hash,
  titleLum: bdTitle.lum,
  goLum: bdGo.lum,
  stayLum: bdStay.lum,
}));

await browser.close();

if (!hopperStarted || hopRestart) {
  console.log("FAIL hopper fire did not start the game or restarted");
  process.exit(2);
}
if (!frameOk) {
  console.log("FAIL could not see C64 frames — not claiming pass");
  process.exit(2);
}
if (rebooted || splash) {
  console.log("FAIL fire restarted the emulator");
  process.exit(2);
}
if (!started) {
  console.log("FAIL boulder dash fire did not change the screen");
  process.exit(2);
}
if (bouncedToTitle) {
  console.log("FAIL boulder dash bounced back to the title");
  process.exit(2);
}
console.log("PASS boulder dash fire started the game and did not restart");
process.exit(0);
