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

test("ios-zoom module keeps native 384×272 and a non-GL host class", () => {
  assert.match(src, /export const IOS_ZOOM_CLASS = "g64-ios-zoom"/);
  assert.match(src, /export const NATIVE_FB_W = 384/);
  assert.match(src, /export const NATIVE_FB_H = 272/);
  assert.match(src, /sw \/ NATIVE_FB_W/);
  assert.match(src, /sh \/ NATIVE_FB_H/);
  assert.match(src, /fit \* ratio/);
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
