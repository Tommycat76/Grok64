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
const { presentBufferSize, isIosPresentActive, isIosPresentLooping } = await server.ssrLoadModule(
  "/src/lib/emu/ios-present.ts",
);
await server.close();

const presentCode = present.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

test("present module is a stripper — no readPixels / 2D blit loop (#47)", () => {
  assert.doesNotMatch(presentCode, /readPixels/);
  assert.doesNotMatch(presentCode, /putImageData/);
  assert.doesNotMatch(presentCode, /drawImage/);
  assert.doesNotMatch(presentCode, /toDataURL|readFsPng|viceScreenshot/);
  assert.doesNotMatch(presentCode, /getContext\(/);
  assert.doesNotMatch(presentCode, /requestAnimationFrame/);
  assert.match(present, /g64-ios-present/);
  assert.match(present, /stripPresentNodes|querySelectorAll/);
  assert.match(host, /stripIosPresent/);
  assert.match(paint, /stopIosPresent|stripIosPresent/);
  assert.match(gate, /no 2D present canvas/);
});

test("no present bitmap — live GL is the picture", () => {
  assert.deepEqual(presentBufferSize(374, 652), { w: 0, h: 0 });
  assert.equal(isIosPresentActive(), false);
  assert.equal(isIosPresentLooping(), false);
});

test("CSS hides leftover 2D present nodes; live GL fills the bezel", () => {
  assert.match(css, /canvas\.g64-ios-present/);
  assert.match(css, /display: none !important/);
  const iosCanvas = css.slice(css.indexOf('html[data-g64os="ios"] #grok64-player canvas'));
  assert.match(iosCanvas, /width: 100% !important/);
  assert.match(iosCanvas, /height: 100% !important/);
  assert.match(iosCanvas, /object-fit: fill !important/);
  assert.match(iosCanvas, /transform: none !important/);
  assert.doesNotMatch(iosCanvas.slice(0, 800), /width: 384px/);
});
