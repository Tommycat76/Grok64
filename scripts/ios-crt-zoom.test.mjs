import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const host = readFileSync(join(root, "src/lib/emu/host.ts"), "utf8");
const css = readFileSync(join(root, "src/styles.css"), "utf8");
const app = readFileSync(join(root, "src/components/emu/Grok64App.tsx"), "utf8");

test("ios-zoom.ts is gone — #51/#52 zoom/slot path is not shipped", () => {
  assert.equal(existsSync(join(root, "src/lib/emu/ios-zoom.ts")), false);
  assert.doesNotMatch(host, /iosCrtZoom|iosZoomLayout|ensureIosZoomHost|layoutIosCrtHost/);
  assert.doesNotMatch(host, /letterboxNativeCss/);
  assert.doesNotMatch(app, /g64-ios-slot|g64-ios-zoom/);
});

test("leftover zoom/slot class names cannot recreate a positioned slot", () => {
  const slot = css.slice(css.indexOf(".g64-ios-slot"), css.indexOf(".g64-ios-slot") + 80);
  assert.match(slot, /display: contents/);
  assert.doesNotMatch(css, /data-g64-ios-slot[\s\S]{0,200}position: absolute/);
  assert.doesNotMatch(css, /data-g64-ios-zoom[\s\S]{0,200}width: 384px/);
});
