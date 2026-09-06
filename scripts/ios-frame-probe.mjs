#!/usr/bin/env node
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const url = process.argv[2] || "http://127.0.0.1:8080/";
const label = process.argv[3] || "iphone";
const offIosPhone = process.argv.includes("--off-ios-phone");
const forceFast = process.argv.includes("--force-fast");
const ua =
  label === "tablet"
    ? "Mozilla/5.0 (Linux; Android 13; TBAF11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Safari/537.36"
    : "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/135.0.7049.53 Mobile/15E148 Safari/604.1";

mkdirSync("/workspace/screenshots", { recursive: true });

function analyze(path) {
  const out = execFileSync(
    "python3",
    [
      "-c",
      `
from PIL import Image
im=Image.open("${path}").convert("RGB")
px=list(im.getdata())
lum=sum(sum(p)/3 for p in px)/len(px)
uniq=len({(p[0]//16,p[1]//16,p[2]//16) for p in px})
print(f"{lum:.1f} {uniq}")
`,
    ],
    { encoding: "utf8" },
  ).trim();
  const [lum, uniq] = out.split(" ").map(Number);
  return { lum, uniq };
}

const browser = await chromium.launch({
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: label === "iphone",
  hasTouch: true,
  userAgent: ua,
});
const page = await context.newPage();
if (offIosPhone) {
  await page.addInitScript(() => {
    globalThis.__G64_IOS_PHONE_OFF = true;
  });
}
if (forceFast) {
  await page.addInitScript(() => {
    globalThis.__G64_FORCE_FAST = true;
  });
}
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForFunction(() => typeof window.__g64?.power === "function", { timeout: 20000 });
await page.evaluate(() => window.__g64.power());

for (let i = 0; i < 60; i++) {
  const ok = await page.evaluate(
    () => window.__g64?.hasFs?.() && window.__g64?.running?.() && window.__g64?.title?.() === "BASIC",
  );
  if (ok) break;
  await page.waitForTimeout(500);
}

await page.waitForTimeout(14000);

const probe = await page.evaluate(async () => {
  const c = document.querySelector("#grok64-player canvas");
  const gl = c?.getContext("webgl2") || c?.getContext("webgl");
  const buf = new Uint8Array(48 * 48 * 4);
  gl?.readPixels(0, 0, 48, 48, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const rgbSum = [...buf].filter((_, i) => i % 4 !== 3).reduce((a, b) => a + b, 0);
  const canvasShot = window.__g64?.canvasShot?.() ?? null;
  let vice = null;
  try {
    vice = await window.__g64?.shot?.();
  } catch {
    vice = null;
  }
  return {
    canvas: c ? { w: c.width, h: c.height } : null,
    glRgbSum: rgbSum,
    canvasShotBytes: canvasShot?.bytes ?? 0,
    canvasB64: canvasShot?.b64 ?? null,
    viceBytes: vice?.bytes ?? 0,
    viceSrc: vice?.src ?? null,
    viceB64: vice?.b64 ?? null,
    core: (() => {
      const log = (window.__g64log || []).find((l) => String(l).includes("boot-begin"));
      const m = log ? String(log).match(/"core":"([^"]+)"/) : null;
      return m?.[1] ?? null;
    })(),
    unlock: !!document.querySelector(".g64-unlock"),
  };
});

const out = { label, ...probe };
if (probe.canvasB64) {
  const p = `/workspace/screenshots/probe-${label}-canvas.png`;
  writeFileSync(p, Buffer.from(probe.canvasB64, "base64"));
  out.canvasPx = analyze(p);
}
if (probe.viceB64) {
  const p = `/workspace/screenshots/probe-${label}-vice.png`;
  writeFileSync(p, Buffer.from(probe.viceB64, "base64"));
  out.vicePx = analyze(p);
}
delete out.canvasB64;
delete out.viceB64;
console.log(JSON.stringify(out, null, 2));
await browser.close();
