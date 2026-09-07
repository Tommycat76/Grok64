import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const present = readFileSync(join(root, "src/lib/emu/ios-present.ts"), "utf8");
const paint = readFileSync(join(root, "src/lib/emu/ios-paint.ts"), "utf8");
const host = readFileSync(join(root, "src/lib/emu/host.ts"), "utf8");
const css = readFileSync(join(root, "src/styles.css"), "utf8");
const gate = readFileSync(join(root, "scripts/crt-fill-gate.mjs"), "utf8");

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { presentBufferSize, IOS_PRESENT_MIN_FRAME_MS, IOS_PRESENT_W, IOS_PRESENT_H, IOS_PRESENT_FAIL_LIMIT } =
  await server.ssrLoadModule("/src/lib/emu/ios-present.ts");
await server.close();

test("present copies live WebGL with readPixels, never PNG or VICE getContext", () => {
  assert.match(present, /readPixels/);
  assert.match(present, /putImageData/);
  assert.match(present, /g64-ios-present/);
  assert.match(present, /getContext\("2d"/);
  assert.doesNotMatch(present, /ctx\.drawImage|drawImage\(src/);
  assert.doesNotMatch(present, /toDataURL|readFsPng|viceScreenshot/);
  assert.doesNotMatch(present, /getContext\("webgl/);
  assert.match(host, /startIosPresent/);
  assert.match(paint, /stopIosPresent/);
  assert.match(gate, /g64-ios-present/);
});

test("present bitmap stays 384x272 even for a tall iPhone bezel", () => {
  assert.deepEqual(presentBufferSize(374, 652), { w: 384, h: 272 });
  assert.deepEqual(presentBufferSize(390, 844), { w: 384, h: 272 });
  assert.equal(IOS_PRESENT_W, 384);
  assert.equal(IOS_PRESENT_H, 272);
  assert.doesNotMatch(present, /dest\.width = sw/);
  assert.doesNotMatch(present, /box\.clientWidth/);
  assert.doesNotMatch(present, /box\.clientHeight/);
});

test("present copies are throttled (~14fps) and stop on context loss", () => {
  assert.ok(IOS_PRESENT_MIN_FRAME_MS >= 50, "must not copy every rAF on CriOS");
  assert.ok(IOS_PRESENT_FAIL_LIMIT >= 3);
  assert.match(present, /readPixels/);
  assert.match(present, /isContextLost/);
  assert.match(present, /pauseIosPresentKeepFrame/);
  assert.match(present, /visibilitychange/);
  assert.match(present, /webglcontextlost/);
  assert.match(paint, /pauseIosPresentKeepFrame/);
  assert.match(paint, /resumeIosPresent/);
  assert.doesNotMatch(paint, /resetIosPaintState\(\);\s*\n\s*\}/);
});

test("empty present canvas cannot cover READY", () => {
  assert.match(present, /g64-ios-present-on/);
  assert.match(css, /g64-ios-present:not\(\.g64-ios-present-on\)/);
  assert.match(css, /visibility: hidden/);
});

test("present CSS overrides .g64-screen canvas object-fit:contain (letterbox stamp)", () => {
  const rule = css.slice(css.indexOf(".g64-screen > canvas.g64-ios-present"));
  assert.match(rule.slice(0, 700), /object-fit: fill !important/);
  assert.match(css, /\.g64-screen canvas \{[\s\S]*?object-fit: contain/);
});
