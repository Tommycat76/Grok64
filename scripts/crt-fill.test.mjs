import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FILL_MIN,
  classifyStampCorner,
  cssPx,
  decodePng,
  fillRect,
  filledCrtFixture,
  fillsBox,
  makeRgba,
  oldStampLayoutFails,
  paintFails,
  paintedContent,
  tomStampBottomLeftFixture,
  tomStampFixture,
} from "./crt-fill-paint.mjs";
import { deflateSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const host = readFileSync(join(root, "src/lib/emu/host.ts"), "utf8");
const css = readFileSync(join(root, "src/styles.css"), "utf8");
const docs = readFileSync(join(root, "docs/STATIC-HOSTING.md"), "utf8");
const gatePath = join(root, "scripts/crt-fill-gate.mjs");
const paintPath = join(root, "scripts/crt-fill-paint.mjs");

test("Plex CRT fill gate script exists and documents iPhone viewport fill", () => {
  assert.equal(existsSync(gatePath), true);
  assert.equal(existsSync(paintPath), true);
  const gate = readFileSync(gatePath, "utf8");
  assert.match(gate, /crt-fill-gate/);
  assert.match(gate, /390/);
  assert.match(gate, /844/);
  assert.match(readFileSync(paintPath, "utf8"), /FILL_MIN = 0\.85/);
  assert.match(readFileSync(paintPath, "utf8"), /COVERAGE_MIN = 0\.15/);
  assert.match(gate, /grok64\.tomsprojects\.cc/);
  assert.match(gate, /8091/);
  assert.match(gate, /not a Tom PASS|not a real CriOS PASS/i);
  assert.match(gate, /g64-boot/);
  assert.match(gate, /g64-screen/);
  assert.match(gate, /g64-bezel/);
  assert.match(gate, /paintedContent|shotPaint/);
  assert.match(gate, /g64-ios-present/);
  assert.match(gate, /glPaintedSrc|readPixels/);
  assert.match(gate, /hideChrome|g64-screen/);
  assert.match(gate, /untransformed/);
  assert.match(gate, /FIRST_CRT_MAX_MS/);
  assert.match(gate, /function hasCssScale/);
  assert.doesNotMatch(gate, /note\(\/scale\\\(\/i\.test\(String\(ready\?\.playerXf/);
});

test("gate treats computed matrix as scale (Plex getComputedStyle)", () => {
  const gate = readFileSync(gatePath, "utf8");
  const fnSrc = gate.match(/export function hasCssScale\([\s\S]*?\n\}|function hasCssScale\([\s\S]*?\n\}/);
  assert.ok(fnSrc, "hasCssScale missing");
  const hasCssScale = new Function(`const SCALE_EPS = 0.02;\n${fnSrc[0].replace(/^export /, "")}\nreturn hasCssScale;`)();
  assert.equal(hasCssScale("matrix(1, 0, 0, 2.39706, 0, 0)"), true);
  assert.equal(hasCssScale("matrix(0.92, 0, 0, 2.4, 0, 0)"), true);
  assert.equal(hasCssScale("scale(1, 2.39706)"), true);
  assert.equal(hasCssScale("none"), false);
  assert.equal(hasCssScale("matrix(1, 0, 0, 1, 0, 0)"), false);
  assert.equal(hasCssScale(""), false);
});

test("gate fails Tom's #44 stamp even when DOM wrappers report fill 1.0", () => {
  const stamp = tomStampFixture(374, 652);
  const paint = paintedContent(stamp.data, stamp.width, stamp.height);
  assert.equal(paint.empty, false);
  assert.equal(paint.corner, "top-right");
  assert.ok(paint.fill < FILL_MIN || paint.coverage < 0.15, `stamp fill ${paint.fill} cov ${paint.coverage} should be ≪ bezel`);
  assert.ok(paintFails(paint), "paintFails must reject the stamp");
  // Transformed DOM boxes can still be 1.0 — that must not pass.
  assert.equal(fillsBox(374, 652, 374, 652), true);
  assert.equal(oldStampLayoutFails(384, 272, 374, 652), true);
  const bl = tomStampBottomLeftFixture(374, 652);
  const blPaint = paintedContent(bl.data, bl.width, bl.height);
  assert.equal(blPaint.corner, "bottom-left");
  assert.ok(paintFails(blPaint), "GL-origin bottom-left stamp must also fail");
});

test("gate fails every corner stamp, not only bottom-left", () => {
  const w = 360;
  const h = 600;
  const img = makeRgba(w, h, [0x6c, 0x5a, 0x9a, 255]);
  fillRect(img, w - 8 - 110, 8, 110, 80, [0x12, 0x16, 0x3a, 255]);
  const paint = paintedContent(img.data, w, h);
  assert.equal(paint.corner, "top-right");
  assert.ok(paintFails(paint));
});

test("filled CRT painted bbox passes", () => {
  const img = filledCrtFixture(374, 652);
  const paint = paintedContent(img.data, img.width, img.height);
  assert.equal(paint.empty, false);
  assert.equal(paint.corner, "full");
  assert.equal(paintFails(paint), null);
});

test("solid-black CRT is not a painted frame", () => {
  const img = makeRgba(374, 652, [12, 12, 14, 255]);
  fillRect(img, 8, 8, 358, 636, [0, 0, 0, 255]);
  const paint = paintedContent(img.data, img.width, img.height);
  assert.equal(paint.empty, true);
  assert.match(paintFails(paint) ?? "", /blank|solid-black|no painted/i);
});

test("sparse chrome / corner AA with a full bbox still fails coverage", () => {
  const img = makeRgba(374, 652, [9, 9, 10, 255]);
  fillRect(img, 16, 16, 3, 3, [255, 255, 255, 255]);
  fillRect(img, 350, 620, 3, 3, [255, 255, 255, 255]);
  fillRect(img, 12, 560, 48, 48, [220, 220, 220, 255]);
  const paint = paintedContent(img.data, img.width, img.height);
  assert.ok(paintFails(paint), "bbox-only fill must not pass chrome-only pixels");
});

test("blank bezel (39s no CRT) fails", () => {
  const img = makeRgba(374, 652, [12, 12, 14, 255]);
  const paint = paintedContent(img.data, img.width, img.height);
  assert.equal(paint.empty, true);
  assert.match(paintFails(paint) ?? "", /blank|no painted/i);
});

test("classifyStampCorner labels bottom-left", () => {
  assert.equal(classifyStampCorner({ x: 8, y: 520, w: 120, h: 90 }, 374, 652), "bottom-left");
  assert.equal(classifyStampCorner({ x: 4, y: 4, w: 360, h: 640 }, 374, 652), "full");
});

test("cssPx parses computed style", () => {
  assert.equal(cssPx("384px"), 384);
  assert.equal(cssPx("272.5px"), 272.5);
  assert.equal(cssPx("none"), 0);
});

test("old 384×272 CSS lock fails a tall phone bezel", () => {
  assert.equal(oldStampLayoutFails(384, 272, 374, 652), true);
  assert.equal(oldStampLayoutFails(374, 652, 374, 652), false);
});

test("decodePng reads a 1×1 RGB PNG", () => {
  const png = decodePng(tinyRgbPng(255, 0, 0));
  assert.equal(png.width, 1);
  assert.equal(png.height, 1);
  assert.equal(png.data[0], 255);
  assert.equal(png.data[1], 0);
  assert.equal(png.data[2], 0);
});

test("hosting docs tell the coordinator how to run the fill gate", () => {
  assert.match(docs, /node scripts\/crt-fill-gate\.mjs/);
  assert.match(docs, /PLEXnTORRENT_HP|Plex/);
  assert.match(docs, /painted|screenshot/i);
});

test("remapViceViewport expands a 384×272 stamp in a larger drawing buffer", () => {
  assert.match(host, /export function remapViceViewport/);
  assert.match(host, /drawingW \* drawingH\) < 0\.85/);
  assert.match(host, /w: drawingW, h: drawingH/);
});

test("iOS CRT fill is native 384 CSS + present canvas, never wrapper scale", () => {
  const iosFn = host.slice(host.indexOf("function lockNativeFbCss"), host.indexOf("export async function recycleCore"));
  assert.match(iosFn, /width", "384px"/);
  assert.match(iosFn, /height", "272px"/);
  assert.match(iosFn, /startIosPresent/);
  assert.doesNotMatch(iosFn, /translate3d\(0,0,0\) scale\(/);
  assert.doesNotMatch(iosFn, /devicePixelRatio/);
  assert.match(host, /remapViceViewport/);
  assert.match(host, /prefetchViceCores/);
  assert.match(host, /this\.width = 384/);
  assert.match(host, /lockIosClientBox\(this, 384, 272\)/);
});

test("iOS phone screen fill CSS does not use the #43 cqh or #44 384px lock", () => {
  const idx = css.indexOf('html[data-g64os="ios"] .g64-app[data-device="phone"] .g64-screen {');
  assert.ok(idx >= 0);
  const rule = css.slice(idx, css.indexOf("}", idx) + 1);
  assert.match(rule, /inset: 8px/);
  assert.doesNotMatch(rule, /100cqh/);
  assert.doesNotMatch(rule, /container-type/);
  const canvas = css.slice(css.indexOf('html[data-g64os="ios"] #grok64-player canvas'));
  assert.match(canvas, /width: 384px !important/);
  assert.match(canvas, /height: 272px !important/);
  assert.match(canvas, /transform: none !important/);
  assert.match(css, /\.g64-ios-present/);
  assert.match(css, /html\[data-g64os="ios"\] \.g64-screen > canvas\.g64-ios-present/);
});

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function tinyRgbPng(r, g, b) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const idat = deflateSync(Buffer.from([0, r, g, b]));
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}
