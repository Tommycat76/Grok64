import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lockedPath = join(root, "docs/IOS_CRT_LOCKED_GOOD.md");
const failPath = join(root, "docs/IOS_CRT_KNOWN_FAILURES.md");
const agents = readFileSync(join(root, "AGENTS.project.md"), "utf8");
const host = readFileSync(join(root, "src/lib/emu/host.ts"), "utf8");

function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

test("locked-good doc records Tom SUCCESS at 3f80fc8 / #54", () => {
  assert.equal(existsSync(lockedPath), true);
  const doc = readFileSync(lockedPath, "utf8");
  assert.match(doc, /KNOWN GOOD/);
  assert.match(doc, /3f80fc8/);
  assert.match(doc, /#54/);
  assert.match(doc, /DlWAL8fJ/);
  assert.match(doc, /SUCCESS/);
  assert.match(doc, /READY paints|READY paints on CriOS/);
  assert.match(doc, /Jiffy/);
  assert.match(doc, /Boulder Dash|BD briefly/);
  assert.match(doc, /preserveDrawingBuffer/);
  assert.match(doc, /lockIosBacking/);
  assert.match(doc, /remapViceViewport/);
  assert.match(doc, /this\.width = 384|pre-size/);
  assert.match(doc, /preserveWebglBuffer/);
  assert.match(doc, /applyIosCrtStyle/);
  assert.match(doc, /ios-paint/);
  assert.match(doc, /ios-present/);
  assert.match(doc, /384:272|384 \/ 272/);
  assert.match(doc, /must not touch|without Tom/i);
});

test("known-failures and AGENTS point at the locked-good doc", () => {
  const fails = readFileSync(failPath, "utf8");
  assert.match(fails, /## KNOWN GOOD/);
  assert.match(fails, /IOS_CRT_LOCKED_GOOD/);
  assert.match(fails, /3f80fc8/);
  assert.match(agents, /IOS_CRT_LOCKED_GOOD/);
  assert.match(agents, /3f80fc8/);
});

test("host.ts code (not comments) must not revive #42/#53 backing locks", () => {
  const hostCode = codeOnly(host);
  assert.doesNotMatch(hostCode, /lockIosBacking/);
  assert.doesNotMatch(hostCode, /remapViceViewport/);
  const patched = host.slice(host.indexOf("function preserveWebglBuffer"), host.indexOf("type GuardedGm"));
  const patchedCode = codeOnly(patched);
  assert.match(patched, /preserveDrawingBuffer/);
  assert.doesNotMatch(patchedCode, /this\.width\s*=\s*384/);
  assert.doesNotMatch(patchedCode, /this\.height\s*=\s*272/);
  assert.doesNotMatch(patchedCode, /lockIosBacking/);
  assert.doesNotMatch(patchedCode, /remapViceViewport/);
  const getCtx = patchedCode.indexOf("getContext");
  assert.ok(getCtx >= 0, "preserveWebglBuffer must patch getContext");
  const beforeCtx = patchedCode.slice(0, getCtx);
  assert.doesNotMatch(beforeCtx, /this\.width\s*=\s*384/);
});
