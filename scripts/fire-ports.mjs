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
im2=im.resize((8,8))
hsh=''.join('1' if (p[0]+p[1]+p[2])>240 else '0' for p in im2.getdata())
print(f'{w} {h} {r:.1f} {g:.1f} {b:.1f} {lum:.1f} {uniq} {hsh}')
`,
    ],
    { encoding: "utf8" },
  ).trim();
  const [w, h, r, g, b, lum, uniq, hsh] = out.split(" ");
  return { w: +w, h: +h, r: +r, g: +g, b: +b, lum: +lum, uniq: +uniq, hash: hsh };
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
    candidates.push({ path: p, src: "canvas", ...analyze(p) });
  }
  if (grabbed?.vice?.b64) {
    const p = `/workspace/screenshots/${name}-vice.png`;
    writeFileSync(p, Buffer.from(grabbed.vice.b64, "base64"));
    candidates.push({ path: p, src: grabbed.vice.src || "vice", ...analyze(p) });
  }
  candidates.sort((a, b) => {
    const aC = a.src === "canvas" ? 1 : 0;
    const bC = b.src === "canvas" ? 1 : 0;
    if (aC !== bC && (a.uniq >= 2 || b.uniq >= 2)) return bC - aC;
    return b.uniq - a.uniq || b.lum - a.lum;
  });
  const best = candidates[0] || { src: "page", ...analyze(path) };
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

function classify(fr) {
  if (!fr) return "none";
  const { r, g, b, lum } = fr;
  if (lum < 12) return "black";
  if (r > 80 && g > 80 && b > 80 && Math.abs(r - g) < 25 && Math.abs(g - b) < 25) return "white";
  if (g > r + 8 && g > b + 8) return "green";
  if (r > 40 && g > 30 && r + g > b * 2.2 && b < 70) return "yellow";
  return `other:${lum.toFixed(0)}`;
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
  console.log("FAIL no fs", (await page.evaluate(() => window.__g64log ?? [])).slice(-12));
  await browser.close();
  process.exit(2);
}

const probe = await page.evaluate(() => {
  const emu = window.__ejs;
  const M = emu?.Module || {};
  const keys = Object.keys(M).filter((k) =>
    /simulat|input|joy|controller|command_event|libretro_device|cwrap/i.test(k),
  );
  return {
    ...window.__g64?.probe?.(),
    extra: keys.slice(0, 50),
    hasSetDev: typeof M._retro_set_controller_port_device,
    hasCwrap: typeof M.cwrap,
  };
});
console.log("PROBE", JSON.stringify(probe));
const logs1 = await page.evaluate(() => window.__g64log ?? []);
console.log("BOOTLOG", JSON.stringify(logs1.filter((l) => /joy-device|joy-bound|core-start|play-un/.test(String(l)))));

await page.evaluate(async () => {
  await window.__g64?.load?.("/software/byte-hopper.prg", "byte-hopper.prg");
});
await waitReady(20000);
await page.waitForTimeout(600);
const hopTitle = await saveShot("ports-hopper-title");
await page.evaluate(() => window.__g64?.fire?.(true));
await page.waitForTimeout(700);
const hopGo = await saveShot("ports-hopper-go");
await page.evaluate(() => window.__g64?.fire?.(false));
const hopperStarted = hopGo.hash !== hopTitle.hash && (hopGo.g - hopTitle.g > 6 || Math.abs(hopGo.lum - hopTitle.lum) > 8);
console.log("HOPPER", JSON.stringify({ hopperStarted, title: classify(hopTitle), go: classify(hopGo) }));

await page.evaluate(async () => {
  await window.__g64?.load?.("/software/ports.prg", "ports.prg");
});
const portsReady = await waitReady(20000);
console.log("PORTS READY", JSON.stringify({
  ...portsReady,
  title: await page.evaluate(() => window.__g64?.title?.()),
}));
await page.waitForTimeout(1200);
const idle = await saveShot("ports-idle");
console.log("PORTS IDLE", classify(idle));

await page.evaluate(() => window.__g64?.fire?.(true));
await page.waitForTimeout(25);
const early = await saveShot("ports-early");
await page.waitForTimeout(70);
const mid = await saveShot("ports-mid");
await page.waitForTimeout(90);
const late = await saveShot("ports-late");
await page.evaluate(() => window.__g64?.fire?.(false));
await page.waitForTimeout(400);
const after = await saveShot("ports-after");

const colors = {
  idle: classify(idle),
  early: classify(early),
  mid: classify(mid),
  late: classify(late),
  after: classify(after),
};
const sawP2 = [colors.early, colors.mid, colors.late].some((c) => c === "green" || c === "white");
const sawP1 = [colors.early, colors.mid, colors.late].some((c) => c === "yellow" || c === "white");
const both = [colors.early, colors.mid, colors.late].some((c) => c === "white") || (sawP1 && sawP2);
console.log("PORTS", JSON.stringify({ colors, sawP1, sawP2, both, logs: (await page.evaluate(() => window.__g64log ?? [])).filter((l) => /FIRE|joy-device|fire-blocked/.test(String(l))).slice(-16) }));

let bd = null;
if (sawP1 || both) {
  await page.locator('button[aria-label="Software"]').first().click();
  await page.locator(".g64-sheet").waitFor({ state: "visible", timeout: 8000 });
  const search = page.locator(".g64-search input");
  await search.fill("Boulder Dash");
  await page.locator('.g64-search button[type="submit"]').click();
  await page.waitForTimeout(2800);
  const hitTitles = await page.locator(".g64-hit strong").allTextContents();
  console.log("BD HITS", JSON.stringify(hitTitles.slice(0, 12)));
  const exact = page.locator(".g64-hit").filter({ has: page.locator("strong", { hasText: /^Boulder Dash$/i }) }).first();
  const playHit = (await exact.count()) ? exact : page.locator(".g64-hit").filter({ hasText: /boulder dash/i }).filter({ hasNotText: /construction|kit|preview|editor/i }).first();
  if (await playHit.count()) {
    await playHit.locator('button[aria-label^="Play"]').click();
    await waitReady(25000);
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.locator(".g64-sheet").waitFor({ state: "hidden", timeout: 4000 }).catch(() => undefined);
    await page.waitForTimeout(2500);
    const bdTitle = await saveShot("ports-bd-title");
    const bootsBefore = (await page.evaluate(() => window.__g64log ?? [])).filter((l) => /boot-begin|restart-ok|hot-swap/.test(String(l))).length;
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.__g64?.fire?.(true));
      await page.waitForTimeout(400);
      await page.evaluate(() => window.__g64?.fire?.(false));
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(1600);
    const bdGo = await saveShot("ports-bd-go");
    const afterLogs = await page.evaluate(() => window.__g64log ?? []);
    const bootsAfter = afterLogs.filter((l) => /boot-begin|restart-ok|hot-swap/.test(String(l))).length;
    const started = bdGo.hash !== bdTitle.hash && Math.abs(bdGo.lum - bdTitle.lum) + Math.abs(bdGo.r - bdTitle.r) + Math.abs(bdGo.g - bdTitle.g) > 12;
    bd = {
      started,
      rebooted: bootsAfter > bootsBefore,
      titleLum: bdTitle.lum,
      goLum: bdGo.lum,
      titleHash: bdTitle.hash,
      goHash: bdGo.hash,
      fires: afterLogs.filter((l) => /FIRE down/.test(String(l))).length,
    };
    console.log("BD", JSON.stringify(bd));
  } else {
    console.log("NO BD HITS");
  }
}

await browser.close();

if (!hopperStarted) {
  console.log("FAIL hopper fire did not start");
  process.exit(2);
}
if (!sawP2) {
  console.log("FAIL port 2 fire not seen");
  process.exit(2);
}
if (!sawP1) {
  console.log("FAIL port 1 fire not seen — title fire still dead for port-1 games");
  process.exit(2);
}
console.log("PASS both CIA ports saw fire", JSON.stringify({ colors, bd }));
process.exit(0);
