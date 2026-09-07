import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const host = readFileSync(join(root, "src/lib/emu/host.ts"), "utf8");
const css = readFileSync(join(root, "src/styles.css"), "utf8");
const docs = readFileSync(join(root, "docs/STATIC-HOSTING.md"), "utf8");
const gatePath = join(root, "scripts/crt-fill-gate.mjs");

test("Plex CRT fill gate script exists and documents iPhone viewport fill", () => {
  assert.equal(existsSync(gatePath), true);
  const gate = readFileSync(gatePath, "utf8");
  assert.match(gate, /crt-fill-gate/);
  assert.match(gate, /390/);
  assert.match(gate, /844/);
  assert.match(gate, /FILL_MIN = 0\.85/);
  assert.match(gate, /grok64\.tomsprojects\.cc/);
  assert.match(gate, /8091/);
  assert.match(gate, /not a Tom PASS|not a real CriOS PASS/i);
  assert.match(gate, /g64-boot/);
  assert.match(gate, /g64-screen/);
  assert.match(gate, /g64-bezel/);
});

test("hosting docs tell the coordinator how to run the fill gate", () => {
  assert.match(docs, /node scripts\/crt-fill-gate\.mjs/);
  assert.match(docs, /PLEXnTORRENT_HP|Plex/);
});

test("iOS CRT scale is on #grok64-player, never devicePixelRatio on the canvas", () => {
  const iosFn = host.slice(host.indexOf("export function applyIosCrtStyle"), host.indexOf("export async function recycleCore"));
  assert.match(iosFn, /translate3d\(0,0,0\) scale\(/);
  assert.match(iosFn, /#grok64-player/);
  assert.doesNotMatch(iosFn, /devicePixelRatio/);
  assert.match(iosFn, /transform", "none"/);
});

test("iOS phone screen fill CSS does not use the #43 cqh self-size recipe", () => {
  const idx = css.indexOf('html[data-g64os="ios"] .g64-app[data-device="phone"] .g64-screen {');
  assert.ok(idx >= 0);
  const rule = css.slice(idx, css.indexOf("}", idx) + 1);
  assert.match(rule, /width: 100% !important/);
  assert.match(rule, /height: 100% !important/);
  assert.doesNotMatch(rule, /100cqh/);
  assert.doesNotMatch(rule, /width: auto/);
  assert.doesNotMatch(rule, /container-type/);
});
