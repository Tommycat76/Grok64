import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docPath = join(root, "docs/IOS_CRT_KNOWN_FAILURES.md");
const agents = readFileSync(join(root, "AGENTS.project.md"), "utf8");
const host = readFileSync(join(root, "src/lib/emu/host.ts"), "utf8");
const paint = readFileSync(join(root, "src/lib/emu/ios-paint.ts"), "utf8");
const present = readFileSync(join(root, "src/lib/emu/ios-present.ts"), "utf8");
const gate = readFileSync(join(root, "scripts/crt-fill-gate.mjs"), "utf8");
const docs = readFileSync(join(root, "docs/STATIC-HOSTING.md"), "utf8");

test("known-failures doc exists and lists Tom phone failures 1–7", () => {
  assert.equal(existsSync(docPath), true);
  const doc = readFileSync(docPath, "utf8");
  assert.match(doc, /Read `docs\/IOS_CRT_KNOWN_FAILURES\.md` first/);
  assert.match(doc, /toDataURL|PNG poll/);
  assert.match(doc, /scale\(\)|wrapper/);
  assert.match(doc, /drawImage/);
  assert.match(doc, /false green|false-green/i);
  assert.match(doc, /without Tom/);
  assert.match(doc, /#47/);
  assert.match(doc, /readPixels/);
  assert.match(doc, /14fps|~14fps/);
  assert.match(doc, /8876d8a/);
  assert.match(doc, /### 7\.|#7/);
  assert.match(doc, /6c10228/);
  assert.match(doc, /clientWidth/);
  assert.match(doc, /count:0|empty black/i);
  assert.match(doc, /JiffyDOS/);
  assert.match(doc, /#39/);
  assert.match(doc, /build-id|build id/i);
  assert.match(doc, /PETSCII/);
  assert.match(doc, /unit-8|unit 8/i);
  assert.match(doc, /#41/);
  assert.match(doc, /Tom.s phone is the only PASS/);
});

test("project agents and CRT follow-ups point at the known-failures doc", () => {
  assert.match(agents, /docs\/IOS_CRT_KNOWN_FAILURES\.md/);
  assert.match(paint, /docs\/IOS_CRT_KNOWN_FAILURES\.md/);
  assert.match(host, /docs\/IOS_CRT_KNOWN_FAILURES\.md/);
  assert.match(present, /docs\/IOS_CRT_KNOWN_FAILURES\.md/);
  assert.match(gate, /docs\/IOS_CRT_KNOWN_FAILURES\.md/);
  assert.match(docs, /docs\/IOS_CRT_KNOWN_FAILURES\.md/);
});

test("new CRT path is live-GL CSS fill, not failed approaches 1/2/3/6/7", () => {
  const iosFn = host.slice(host.indexOf("function fillBezelCss"), host.indexOf("export async function recycleCore"));
  assert.match(iosFn, /width", "100%"/);
  assert.match(iosFn, /height", "100%"/);
  assert.match(iosFn, /stripIosPresent/);
  assert.match(iosFn, /unlockIosClientBox/);
  assert.doesNotMatch(iosFn, /startIosPresent/);
  assert.doesNotMatch(iosFn, /width", "384px"/);
  assert.doesNotMatch(iosFn, /scale\(/);
  assert.doesNotMatch(iosFn, /(?<!un)lockIosClientBox\(canvas/);
  const iosCode = iosFn.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(iosCode, /readPixels/);
  const presentCode = present.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(presentCode, /readPixels/);
  assert.doesNotMatch(presentCode, /drawImage/);
  assert.doesNotMatch(presentCode, /toDataURL/);
  assert.match(paint, /live-webgl/);
  assert.match(host, /function unlockIosClientBox/);
  const patched = host.slice(host.indexOf("function preserveWebglBuffer"), host.indexOf("type GuardedGm"));
  assert.ok(
    patched.indexOf("unlockIosClientBox(this)") > patched.indexOf("orig.call(this, type, merged)"),
    "clientWidth lie must be cleared after getContext (#7)",
  );
});

test("gate never claims PASS and requires live GL fill", () => {
  assert.match(gate, /Tom's phone is the only PASS/);
  assert.match(gate, /must never claim PASS|never claim PASS/i);
  assert.doesNotMatch(gate, /GATE PASS/);
  assert.match(gate, /live GL CSS px vs bezel/);
  assert.match(gate, /no 2D present canvas covering live GL/);
  assert.match(gate, /#7 384x272 lie/);
  assert.doesNotMatch(gate, /present canvas revealed after a lit copy/);
  assert.doesNotMatch(gate, /present bitmap stays 384x272/);
  assert.doesNotMatch(gate, /GL clientWidth is native 384x272/);
});
