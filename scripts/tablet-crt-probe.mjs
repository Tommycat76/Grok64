/**
 * Onn tablet CRT probe — real VICE core, real WebGL.
 *
 * Answers the only question that matters for the stamp: is the picture
 * small because the CSS box is small, or because the GL viewport /
 * drawing buffer disagree with the canvas backing?
 *
 * Read-only: never getContext (uses the context VICE stashed as __g64gl),
 * never readPixels into a present layer. Screenshot + bbox only.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { decodePng, paintedContent } from "./crt-fill-paint.mjs";

const url = process.argv[2] || "http://127.0.0.1:8080/";
const WAIT_MS = Number(process.env.PROBE_WAIT_MS || 60000);
mkdirSync("/workspace/screenshots", { recursive: true });

const ONN_UA =
  "Mozilla/5.0 (Linux; Android 13; TBAF11 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Safari/537.36";

const cases = [
  { name: "onn-land", ua: ONN_UA, viewport: { width: 1280, height: 800 }, dpr: 1.5 },
  { name: "onn-port", ua: ONN_UA, viewport: { width: 800, height: 1280 }, dpr: 1.5 },
];

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});

const probe = () => {
  const player = document.getElementById("grok64-player");
  const canvas = player?.querySelector("canvas:not(.g64-ios-present)");
  const glass = document.querySelector(".g64-screen");
  const bezel = document.querySelector(".g64-bezel");
  const stage = document.querySelector(".g64-stage");
  const box = (n) => {
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const cssBox = (n) => {
    if (!n) return null;
    const cs = getComputedStyle(n);
    return { w: cs.width, h: cs.height, pos: cs.position, xf: cs.transform, of: cs.objectFit };
  };
  let gl = null;
  const ctx = canvas && canvas.__g64gl;
  if (ctx) {
    try {
      const vp = ctx.getParameter(ctx.VIEWPORT);
      gl = {
        viewport: [vp[0], vp[1], vp[2], vp[3]],
        drawW: ctx.drawingBufferWidth,
        drawH: ctx.drawingBufferHeight,
        scissor: Array.from(ctx.getParameter(ctx.SCISSOR_BOX) || []),
        scissorOn: ctx.isEnabled(ctx.SCISSOR_TEST),
      };
    } catch (e) {
      gl = { error: String(e).slice(0, 120) };
    }
  }
  return {
    device: document.querySelector(".g64-app")?.getAttribute("data-device") ?? null,
    build: document.querySelector("[data-g64-build]")?.getAttribute("data-g64-build") ?? null,
    dpr: window.devicePixelRatio,
    running: window.__g64?.running?.() ?? null,
    booting: window.__g64?.booting?.() ?? null,
    hasFs: window.__g64?.hasFs?.() ?? null,
    backing: canvas ? { w: canvas.width, h: canvas.height } : null,
    canvasRect: box(canvas),
    canvasCss: cssBox(canvas),
    canvasInline: canvas?.getAttribute("style")?.slice(0, 400) ?? null,
    canvasClass: canvas?.className ?? null,
    canvasParent: canvas?.parentElement
      ? { cls: canvas.parentElement.className, ...box(canvas.parentElement) }
      : null,
    playerRect: box(player),
    glassRect: box(glass),
    bezelRect: box(bezel),
    stageRect: box(stage),
    gl,
  };
};

const results = [];

for (const c of cases) {
  const context = await browser.newContext({
    viewport: c.viewport,
    userAgent: c.ua,
    hasTouch: true,
    isMobile: false,
    deviceScaleFactor: c.dpr,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`);
  });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForFunction(() => typeof window.__g64?.power === "function", { timeout: 20000 });
  await page.evaluate(() => window.__g64.power());

  const timeline = [];
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < WAIT_MS) {
    last = await page.evaluate(probe);
    timeline.push({ t: Date.now() - t0, backing: last.backing, canvasRect: last.canvasRect, gl: last.gl });
    if (last.backing && last.running && !last.booting) break;
    await page.waitForTimeout(1000);
  }
  // let VICE paint a few more frames
  await page.waitForTimeout(6000);
  last = await page.evaluate(probe);

  let paint = null;
  const glass = await page.locator(".g64-screen").first();
  const shot = `/workspace/screenshots/probe-${c.name}-glass.png`;
  try {
    await glass.screenshot({ path: shot });
    const img = decodePng(readFileSync(shot));
    paint = paintedContent(img.data, img.width, img.height);
    delete paint.bg;
  } catch (e) {
    paint = { error: String(e).slice(0, 160) };
  }
  await page.screenshot({ path: `/workspace/screenshots/probe-${c.name}-full.png` });

  results.push({ name: c.name, errors: errors.slice(0, 6), final: last, paint, timeline });
  await context.close();
}

await browser.close();
writeFileSync("/workspace/screenshots/tablet-crt-probe.json", JSON.stringify(results, null, 2));
for (const r of results) {
  console.log(`\n===== ${r.name} =====`);
  console.log("final:", JSON.stringify(r.final, null, 2));
  console.log("paint:", JSON.stringify(r.paint));
  console.log("errors:", JSON.stringify(r.errors));
  console.log("timeline:", JSON.stringify(r.timeline));
}
