import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const present = readFileSync(join(root, "src/lib/emu/ios-present.ts"), "utf8");
const paint = readFileSync(join(root, "src/lib/emu/ios-paint.ts"), "utf8");
const host = readFileSync(join(root, "src/lib/emu/host.ts"), "utf8");
const gate = readFileSync(join(root, "scripts/crt-fill-gate.mjs"), "utf8");

test("present copies live WebGL with drawImage, never PNG or VICE getContext", () => {
  assert.match(present, /drawImage\(src/);
  assert.match(present, /g64-ios-present/);
  assert.match(present, /getContext\("2d"/);
  assert.doesNotMatch(present, /toDataURL|readFsPng|viceScreenshot/);
  assert.doesNotMatch(present, /getContext\("webgl/);
  assert.match(host, /startIosPresent/);
  assert.match(paint, /stopIosPresent/);
  assert.match(gate, /g64-ios-present/);
});
