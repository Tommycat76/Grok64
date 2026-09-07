import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src/lib/emu/ios-zoom.ts"), "utf8");

/** Mirror of src/lib/emu/ios-zoom.ts — keep in lockstep with the source body. */
function iosCrtZoom(sw, sh, dpr = 1) {
  if (!(sw >= 8) || !(sh >= 8)) return 1;
  const fit = Math.min(sw / 384, sh / 272);
  if (!Number.isFinite(fit) || fit <= 0) return 1;
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const z = fit * ratio;
  return Math.max(0.25, Math.min(8, z));
}

function iosZoomUsedSize(z) {
  const zoom = Number.isFinite(z) && z > 0 ? z : 1;
  return { w: Math.round(384 * zoom), h: Math.round(272 * zoom) };
}

function iosZoomLayout(sw, sh, dpr = 1) {
  const z = iosCrtZoom(sw, sh, dpr);
  const used = iosZoomUsedSize(z);
  return {
    z,
    usedW: used.w,
    usedH: used.h,
    left: (sw - used.w) / 2,
    top: (sh - used.h) / 2,
  };
}

function iosZoomSlotCentered(slot, bezel, slop = 28) {
  if (!(slot.w >= 8) || !(slot.h >= 8) || !(bezel.w >= 8) || !(bezel.h >= 8)) return false;
  const sx = slot.x + slot.w / 2;
  const sy = slot.y + slot.h / 2;
  const bx = bezel.x + bezel.w / 2;
  const by = bezel.y + bezel.h / 2;
  return Math.abs(sx - bx) <= slop && Math.abs(sy - by) <= slop;
}

test("ios-zoom module keeps native 384×272 and a non-GL host + slot", () => {
  assert.match(src, /export const IOS_ZOOM_CLASS = "g64-ios-zoom"/);
  assert.match(src, /export const IOS_SLOT_CLASS = "g64-ios-slot"/);
  assert.match(src, /export const NATIVE_FB_W = 384/);
  assert.match(src, /export const NATIVE_FB_H = 272/);
  assert.match(src, /sw \/ NATIVE_FB_W/);
  assert.match(src, /sh \/ NATIVE_FB_H/);
  assert.match(src, /fit \* ratio/);
  assert.match(src, /export function iosZoomLayout/);
  assert.match(src, /\(sw - used\.w\) \/ 2/);
  assert.match(src, /\(sh - used\.h\) \/ 2/);
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""), /toDataURL|readPixels|drawImage/);
});

test("iosCrtZoom contain-fits 384×272 into the bezel", () => {
  assert.equal(iosCrtZoom(384, 272, 1), 1);
  assert.ok(Math.abs(iosCrtZoom(374, 652, 1) - 374 / 384) < 1e-6);
  assert.equal(iosCrtZoom(768, 544, 1), 2);
  assert.equal(iosCrtZoom(0, 0, 1), 1);
});

test("iosCrtZoom multiplies contain-fit by dpr for a 1:1 device-pixel blit", () => {
  const z = iosCrtZoom(374, 652, 3);
  assert.ok(z > 2.8 && z < 3);
  assert.ok(Math.abs(z - (374 / 384) * 3) < 1e-6);
  assert.equal(iosCrtZoom(384, 272, 3), 3);
});

test("iosZoomLayout centers a contain-fit letterbox (dpr 1)", () => {
  const layout = iosZoomLayout(374, 652, 1);
  assert.ok(Math.abs(layout.z - 374 / 384) < 1e-6);
  assert.ok(Math.abs(layout.left) < 1, `#51 left-origin would also be ~0 at dpr1; usedW=${layout.usedW}`);
  assert.ok(layout.top > 100, `tall bezel must letterbox, top=${layout.top}`);
  assert.ok(Math.abs(layout.left - (374 - layout.usedW) / 2) < 1e-6);
  assert.ok(Math.abs(layout.top - (652 - layout.usedH) / 2) < 1e-6);
});

test("iosZoomLayout centers dpr overfill (negative offset, not top-left #51)", () => {
  const layout = iosZoomLayout(374, 652, 3);
  assert.ok(layout.left < -100, `overfill must shift left of origin, left=${layout.left}`);
  assert.ok(layout.top < 0, `overfill must shift above origin, top=${layout.top}`);
  assert.ok(Math.abs(layout.left - (374 - layout.usedW) / 2) < 1e-6);
  assert.ok(Math.abs(layout.top - (652 - layout.usedH) / 2) < 1e-6);
  const slot = { x: layout.left, y: layout.top, w: layout.usedW, h: layout.usedH };
  const bezel = { x: 0, y: 0, w: 374, h: 652 };
  assert.equal(iosZoomSlotCentered(slot, bezel), true);
  assert.equal(iosZoomSlotCentered({ x: 0, y: 0, w: layout.usedW, h: layout.usedH }, bezel), false);
});
