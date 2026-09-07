#!/usr/bin/env node
/**
 * Deploy CRT-fill gate — run on PLEXnTORRENT_HP after pull/build/restart.
 *
 * Read docs/IOS_CRT_KNOWN_FAILURES.md first.
 *
 * Chromium (or G64_CHROME) at an iPhone viewport + touch + CriOS UA.
 * This is NOT real iPhone Safari/CriOS. A green run is a painted-layout
 * check, not a Tom PASS. #47 stayed green on Plex while Tom's phone went
 * cold-start → solid black. Cursor-sandbox WebKit is a dead end.
 *
 *   node scripts/crt-fill-gate.mjs
 *   node scripts/crt-fill-gate.mjs https://grok64.tomsprojects.cc/
 *   node scripts/crt-fill-gate.mjs http://127.0.0.1:8091/
 *
 * HARD: asserts the *painted* live-GL picture is not solid black.
 * After #7/#8, a centered 384×272 letterbox is accepted (paint over fill).
 * Tom #44 top-right and GL-origin bottom-left still fail. DOM wrapper
 * fill of 1.0 is never a pass.
 *
 * Also holds after first READY paint and fails if the session remounts
 * to the power splash, __g64 is torn down, the page reloads, or the CRT
 * goes solid black. That is the #46/#47 CriOS failure.
 *
 * Tom’s phone is the only PASS. Never print PASS from this script.
 *
 * Env:
 *   G64_GATE_URL     default live URL
 *   G64_CHROME       path to Chrome/Chromium if Playwright's browser is missing
 *   G64_GATE_SHOTS   screenshot directory (default <repo>/screenshots)
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIRST_CRT_MAX_MS,
  FIRST_CRT_WARN_MS,
  FIRST_OVERLAY_MAX_MS,
  SESSION_HOLD_MS,
  boxFill,
  cssPx,
  decodePng,
  fillsBox,
  isNativeFbCssBox,
  letterboxPaintFails,
  oldStampLayoutFails,
  paintedContent,
} from "./crt-fill-paint.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.argv[2] || process.env.G64_GATE_URL || "https://grok64.tomsprojects.cc/";
const shotDir = process.env.G64_GATE_SHOTS || join(repoRoot, "screenshots");
mkdirSync(shotDir, { recursive: true });

const SCALE_EPS = 0.02;
const IPHONE = { width: 390, height: 844 };
const CRIOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/135.0.7049.53 Mobile/15E148 Safari/604.1";

const failures = [];

function note(ok, msg, extra) {
  if (ok) {
    console.log("OK", msg, extra ? JSON.stringify(extra) : "");
    return;
  }
  failures.push(msg);
  console.log("FAIL", msg, extra ? JSON.stringify(extra) : "");
}

/** getComputedStyle().transform is a matrix, not the author string scale(...). */
export function hasCssScale(xf) {
  const s = String(xf || "").trim().toLowerCase();
  if (!s || s === "none") return false;
  if (s.includes("scale(")) return true;
  const m3 = s.match(/matrix3d\(([^)]+)\)/);
  if (m3) {
    const n = m3[1].split(",").map((x) => Number(x.trim()));
    if (n.length < 11 || n.some((v) => Number.isNaN(v))) return false;
    return Math.abs(n[0] - 1) > SCALE_EPS || Math.abs(n[5] - 1) > SCALE_EPS;
  }
  const m2 = s.match(/matrix\(([^)]+)\)/);
  if (!m2) return false;
  const n = m2[1].split(",").map((x) => Number(x.trim()));
  if (n.length < 4 || n.some((v) => Number.isNaN(v))) return false;
  return Math.abs(n[0] - 1) > SCALE_EPS || Math.abs(n[3] - 1) > SCALE_EPS;
}

function launchOpts() {
  const opts = {
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
    ],
  };
  if (process.env.G64_CHROME) opts.executablePath = process.env.G64_CHROME;
  return opts;
}

const measureSrc = () => {
  const box = (n) => {
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  };
  const bezel = document.querySelector(".g64-bezel");
  const screen = document.querySelector(".g64-screen");
  const boot = document.querySelector(".g64-boot");
  const player = document.getElementById("grok64-player");
  const present = document.querySelector("canvas.g64-ios-present");
  const canvas = player?.querySelector("canvas:not(.g64-ios-present)");
  const cs = canvas ? getComputedStyle(canvas) : null;
  const ns = present ? getComputedStyle(present) : null;
  const ps = player ? getComputedStyle(player) : null;
  const ss = screen ? getComputedStyle(screen) : null;
  const bs = boot ? getComputedStyle(boot) : null;
  const bezelBox = box(bezel);
  const screenBox = box(screen);
  let bezelInner = bezelBox;
  if (bezel && bezelBox) {
    const st = getComputedStyle(bezel);
    const pt = Number.parseFloat(st.paddingTop) || 0;
    const pr = Number.parseFloat(st.paddingRight) || 0;
    const pb = Number.parseFloat(st.paddingBottom) || 0;
    const pl = Number.parseFloat(st.paddingLeft) || 0;
    // iPhone CSS uses inset:8px on the screen (padding may be 0).
    const inset = screen && ss ? Number.parseFloat(ss.top) || 0 : 0;
    const padX = pl + pr || (inset > 0 ? inset * 2 : 0);
    const padY = pt + pb || (inset > 0 ? inset * 2 : 0);
    bezelInner = {
      x: bezelBox.x + (pl || inset),
      y: bezelBox.y + (pt || inset),
      w: Math.max(0, bezelBox.w - padX),
      h: Math.max(0, bezelBox.h - padY),
    };
  }
  const gl = canvas && /** @type {{ __g64gl?: WebGLRenderingContext }} */ (canvas).__g64gl;
  return {
    os: document.documentElement.dataset.g64os ?? null,
    device: document.querySelector(".g64-app")?.getAttribute("data-device") ?? null,
    build: document.querySelector("[data-g64-build]")?.textContent?.trim() ?? null,
    log: Boolean(document.querySelector(".g64-log")),
    splash: Boolean(document.querySelector(".g64-splash")),
    booting: window.__g64?.booting?.() ?? Boolean(boot),
    running: window.__g64?.running?.() ?? false,
    powered: window.__g64?.powered?.() ?? false,
    fs: window.__g64?.hasFs?.() ?? false,
    title: window.__g64?.title?.() ?? null,
    overlay: Boolean(player?.querySelector(".g64-ios-mirror")),
    present: Boolean(present),
    presentOn: present?.classList.contains("g64-ios-present-on") ?? false,
    presentBuf: present ? { w: present.width, h: present.height } : null,
    hasG64: typeof window.__g64 === "object" && window.__g64 != null,
    fb: canvas?.classList.contains("g64-ios-fb") ?? false,
    buf: canvas ? { w: canvas.width, h: canvas.height } : null,
    canvasClient: canvas ? { w: canvas.clientWidth, h: canvas.clientHeight } : null,
    db: gl ? { w: gl.drawingBufferWidth, h: gl.drawingBufferHeight } : null,
    canvasCss: cs ? { w: cs.width, h: cs.height, xf: cs.transform } : null,
    presentCss: ns ? { w: ns.width, h: ns.height, xf: ns.transform } : null,
    playerCss: ps ? { w: ps.width, h: ps.height, xf: ps.transform } : null,
    screenCss: ss ? { w: ss.width, h: ss.height } : null,
    bootCss: bs ? { w: bs.width, h: bs.height } : null,
    playerXf: ps?.transform ?? null,
    bezel: bezelBox,
    bezelInner,
    screen: screenBox,
    boot: box(boot),
    player: box(player),
    canvas: box(canvas),
    presentBox: box(present),
  };
};

async function shotPaint(page, name, { hideChrome = true, inset = 8 } = {}) {
  if (hideChrome) {
    await page.addStyleTag({
      content: ".g64-controls,.g64-unlock{visibility:hidden !important;opacity:0 !important}",
    });
  }
  const loc = page.locator(".g64-screen").first();
  const path = join(shotDir, name);
  let buf;
  try {
    buf = await loc.screenshot({ type: "png" });
  } catch {
    buf = await page.screenshot({ path, fullPage: false, type: "png" });
    writeFileSync(path, buf);
    return { paint: paintedContent(new Uint8ClampedArray(), 0, 0), path, w: 0, h: 0 };
  }
  writeFileSync(path, buf);
  const png = decodePng(buf);
  return {
    paint: paintedContent(png.data, png.width, png.height, { inset }),
    path,
    w: png.width,
    h: png.height,
  };
}

function assertCssFill(label, cssW, cssH, outer, extra = {}) {
  const iw = cssPx(cssW);
  const ih = cssPx(cssH);
  const ow = outer?.w ?? 0;
  const oh = outer?.h ?? 0;
  const f = boxFill(iw, ih, ow, oh);
  const ok = fillsBox(iw, ih, ow, oh);
  note(ok, `${label} css-px fill ${f.area.toFixed(2)} (w ${f.fillW.toFixed(2)} h ${f.fillH.toFixed(2)})`, {
    css: { w: iw, h: ih },
    outer,
    ...extra,
  });
  return f;
}

function assertPainted(label, shot, extra = {}) {
  const fail = letterboxPaintFails(shot.paint);
  note(
    !fail,
    fail
      ? `${label} ${fail}`
      : `${label} painted count:${shot.paint.count} ${shot.paint.corner} (letterbox OK after #7/#8)`,
    {
      bbox: shot.paint.bbox,
      size: { w: shot.w, h: shot.h },
      bg: shot.paint.bg,
      count: shot.paint.count,
      fill: shot.paint.fill,
      ...extra,
    },
  );
  return shot.paint;
}

const browser = await chromium.launch(launchOpts());
const context = await browser.newContext({
  viewport: IPHONE,
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  userAgent: CRIOS_UA,
});
const page = await context.newPage();
const pageErrors = [];
let mainNavs = 0;
let tabCrashed = false;
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("framenavigated", (frame) => {
  if (frame === page.mainFrame()) mainNavs += 1;
});
page.on("crash", () => {
  tabCrashed = true;
});

console.log("GATE url", url);
console.log("GATE viewport", JSON.stringify({ ...IPHONE, dpr: 3, ua: "CriOS-iPhone" }));
console.log("GATE read docs/IOS_CRT_KNOWN_FAILURES.md first.");
console.log("GATE note Cursor-sandbox WebKit is not a ship gate. This script is the Plex painted-CRT check.");
console.log("GATE note DOM getBoundingClientRect fill of 1.0 is not a pass — painted bbox + untransformed CSS px must fill.");
console.log("GATE this is NOT a real CriOS PASS. Chromium-on-Plex can go green while CriOS blacks out (#47).");
console.log("GATE Tom's phone is the only PASS. This script must never claim PASS.");

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => typeof window.__g64?.power === "function", { timeout: 25000 });

const splash = await page.evaluate(measureSrc);
note(Boolean(splash.build), "build id visible on splash", { build: splash.build });
note(!splash.log, "debug log off by default");
await page.screenshot({ path: join(shotDir, "crt-fill-gate-splash.png"), fullPage: false });

const tPower = Date.now();
await page.evaluate(() => window.__g64.power());

let overlayMs = null;
let bootGeom = null;
for (let i = 0; i < 40; i++) {
  const st = await page.evaluate(measureSrc);
  if (st.boot && st.bezel && !st.splash) {
    if (overlayMs == null) overlayMs = Date.now() - tPower;
    bootGeom = st;
    break;
  }
  if (st.running && st.fs && !st.booting) break;
  await page.waitForTimeout(150);
}

if (bootGeom) {
  await page.screenshot({ path: join(shotDir, "crt-fill-gate-boot.png"), fullPage: false });
  const bootShot = await shotPaint(page, "crt-fill-gate-boot-bezel.png");
  note(!bootShot.paint.empty, "boot overlay produced painted pixels (not 39s-blank bezel)", {
    ms: overlayMs,
    fill: bootShot.paint.fill,
    corner: bootShot.paint.corner,
  });
  note(Boolean(bootGeom.boot), "cold-start copy is visible (compact chip, not a full-bezel black sheet)", {
    boot: bootGeom.boot,
    bootCss: bootGeom.bootCss,
  });
  assertCssFill("screen vs bezel (boot, untransformed CSS)", bootGeom.screenCss?.w, bootGeom.screenCss?.h, bootGeom.bezelInner);
  if (bootGeom.boot && bootGeom.bezelInner) {
    const dom = boxFill(bootGeom.boot.w, bootGeom.boot.h, bootGeom.bezelInner.w, bootGeom.bezelInner.h);
    console.log("INFO boot chip DOM-rect (must not be a full-bezel black cover)", JSON.stringify(dom));
    note(
      dom.area < 0.85,
      "boot overlay is a compact chip (full-bezel black sheet hid READY on #47)",
      { area: dom.area, boot: bootGeom.boot, bezelInner: bootGeom.bezelInner },
    );
  }
} else {
  console.log("WARN boot overlay already gone — skip overlay fill (canvas check still runs)");
}

if (overlayMs != null) {
  note(overlayMs <= FIRST_OVERLAY_MAX_MS, `boot overlay visible in ${overlayMs}ms (limit ${FIRST_OVERLAY_MAX_MS})`, {
    overlayMs,
  });
}

const glPaintedSrc = () => {
  const c = document.querySelector("#grok64-player canvas:not(.g64-ios-present)");
  const gl = c && /** @type {{ __g64gl?: WebGLRenderingContext }} */ (c).__g64gl;
  if (!gl) return { max: 0, colored: 0 };
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  if (w < 8 || h < 8) return { max: 0, colored: 0 };
  const buf = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  let max = 0;
  let colored = 0;
  for (let i = 0; i < buf.length; i += 4) {
    const m = Math.max(buf[i], buf[i + 1], buf[i + 2]);
    if (m > max) max = m;
    if (m >= 40) colored += 1;
  }
  return { max, colored };
};

let ready = null;
let crtMs = null;
for (let i = 0; i < 120; i++) {
  ready = await page.evaluate(measureSrc);
  if (ready.fs && ready.running && ready.canvas && ready.buf?.w >= 64 && !ready.splash && !ready.booting) {
    const pix = await page.evaluate(glPaintedSrc);
    if (pix.max >= 40 && pix.colored >= 64) {
      if (crtMs == null) crtMs = Date.now() - tPower;
      break;
    }
  }
  if (Date.now() - tPower > FIRST_CRT_MAX_MS + 2000) break;
  await page.waitForTimeout(400);
}
if (crtMs == null) crtMs = Date.now() - tPower;
await page.waitForTimeout(80);

await page.screenshot({ path: join(shotDir, "crt-fill-gate-ready.png"), fullPage: false });
const readyShot = await shotPaint(page, "crt-fill-gate-ready-bezel.png");

note(Boolean(ready?.build), "build id visible after power", { build: ready?.build });
note(!ready?.log, "debug log still off");
note(!ready?.overlay, "no PNG/paint-poll overlay covering WebGL");
note(!ready?.present, "no 2D present canvas covering live GL (#47 black cover)", {
  present: ready?.present,
  presentOn: ready?.presentOn,
});
note(!ready?.booting, "cold-start overlay dismissed after READY (must not stay as a black cover)", {
  booting: ready?.booting,
  boot: ready?.boot,
});
note(ready?.buf?.w === 384 && ready?.buf?.h === 272, "VICE backing 384x272", ready?.buf);
note(
  isNativeFbCssBox(ready?.canvasClient?.w, ready?.canvasClient?.h),
  "GL clientWidth is native 384x272 (real CSS box, not a #7 lie on CSS 100%)",
  ready?.canvasClient,
);

// #44 stamp path: wrapper scale + 384×272 CSS. CriOS ignores that scale on GL.
note(!hasCssScale(ready?.playerXf), "player wrapper has no CSS scale (CriOS ignores it on the GL layer)", {
  playerXf: ready?.playerXf,
});
note(
  !hasCssScale(ready?.canvasCss?.xf),
  "canvas transform is identity",
  { canvasXf: ready?.canvasCss?.xf },
);

const bezelInner = ready?.bezelInner;
if (ready?.canvasCss && bezelInner) {
  const cssW = cssPx(ready.canvasCss.w);
  const cssH = cssPx(ready.canvasCss.h);
  note(
    isNativeFbCssBox(cssW, cssH),
    "live GL canvas CSS is native 384x272 (letterbox; fill deferred after #7/#8)",
    { bezelInner, glCss: { w: cssW, h: cssH } },
  );
  note(
    oldStampLayoutFails(cssW || 384, cssH || 272, bezelInner.w, bezelInner.h),
    "384x272 CSS does not fill the tall bezel (documented letterbox tradeoff)",
    { bezelInner, glCss: { w: cssW, h: cssH } },
  );
  if (ready.canvas) {
    const dom = boxFill(ready.canvas.w, ready.canvas.h, bezelInner.w, bezelInner.h);
    console.log(
      "INFO canvas DOM-rect vs bezel (letterbox expected; paint count is the gate)",
      JSON.stringify({ dom, css: { w: cssW, h: cssH } }),
    );
  }
}
if (ready?.playerCss && bezelInner) {
  const pw = cssPx(ready.playerCss.w);
  const ph = cssPx(ready.playerCss.h);
  note(
    isNativeFbCssBox(pw, ph),
    "player wrapper CSS is native 384x272 (no scale, no CSS 100%)",
    { playerCss: { w: pw, h: ph } },
  );
}
if (ready?.screenCss && bezelInner) {
  assertCssFill("screen CSS px vs bezel (untransformed)", ready.screenCss.w, ready.screenCss.h, bezelInner);
}

const paint = assertPainted("READY", readyShot, { title: ready?.title, crtMs });
if (paint.corner === "top-right" || paint.corner === "bottom-left") {
  note(false, `READY painted stamp corner ${paint.corner} (Tom #44 is top-right; GL-origin is bottom-left)`, {
    bbox: paint.bbox,
    fill: paint.fill,
  });
} else if (paint.corner && paint.corner !== "full" && paint.corner !== "none") {
  console.log("INFO READY letterbox corner", paint.corner, JSON.stringify(paint.bbox));
}

if (crtMs > FIRST_CRT_WARN_MS) {
  console.log("WARN boot→READY took", crtMs, "ms (iPhone ~39s blank would fail FIRST_CRT_MAX_MS)");
}
note(crtMs <= FIRST_CRT_MAX_MS, `boot→first CRT ${crtMs}ms (limit ${FIRST_CRT_MAX_MS}, flags ~39s blank)`, {
  crtMs,
  overlayMs,
});

const navsAfterReady = mainNavs;
console.log("GATE hold", SESSION_HOLD_MS, "ms — session must stay powered, CRT must stay painted, no reload");
let hold = null;
let holdShot = null;
try {
  await page.waitForTimeout(SESSION_HOLD_MS);
  hold = await page.evaluate(measureSrc);
  holdShot = await shotPaint(page, "crt-fill-gate-hold-bezel.png");
} catch (err) {
  note(false, `session died during hold (${err instanceof Error ? err.message : String(err)})`);
}

note(!tabCrashed, "browser tab did not crash during hold");
note(mainNavs === navsAfterReady, "no full page reload / navigation after READY", {
  mainNavs,
  navsAfterReady,
});
if (hold) {
  note(Boolean(hold.hasG64), "__g64 still mounted (no teardown / remount)");
  note(hold.powered && !hold.splash, "session still powered (no splash remount)", {
    powered: hold.powered,
    splash: hold.splash,
    running: hold.running,
    title: hold.title,
  });
  note(!hold.present, "no 2D present canvas after hold", { present: hold.present });
  note(hold.buf?.w === 384 && hold.buf?.h === 272, "VICE backing still 384x272 after hold", hold.buf);
}
if (holdShot) {
  const holdPaint = assertPainted("READY hold", holdShot, { title: hold?.title });
  if (holdPaint.empty) {
    note(false, "CRT went solid black after first paint (Tom #46 ~5s black)");
  }
}

if (pageErrors.length) {
  note(false, `page errors: ${pageErrors.slice(0, 3).join(" | ")}`);
}

await browser.close();

console.log("");
console.log(
  "GATE summary",
  JSON.stringify({
    url,
    build: hold?.build ?? ready?.build ?? splash.build,
    overlayMs,
    crtMs,
    holdMs: SESSION_HOLD_MS,
    paint: { fill: paint.fill, corner: paint.corner, empty: paint.empty },
    holdPaint: holdShot ? { fill: holdShot.paint.fill, corner: holdShot.paint.corner, empty: holdShot.paint.empty } : null,
    failures: failures.length,
    fail: failures,
  }),
);
console.log("GATE this is a Plex painted-layout check, not a real CriOS PASS.");
console.log("GATE Chromium-on-Plex still is not CriOS PASS — Tom's phone is the only PASS.");
console.log("GATE Read docs/IOS_CRT_KNOWN_FAILURES.md first. Do not claim PASS from this run.");
if (failures.length) process.exit(2);
console.log("GATE painted layout + session hold OK — not a PASS. Coordinator still needs Tom hard-refresh on the phone.");
process.exit(0);
