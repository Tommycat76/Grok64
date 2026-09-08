import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const unlock = readFileSync(join(root, "src/lib/emu/audio-unlock.ts"), "utf8");
const app = readFileSync(join(root, "src/components/emu/Grok64App.tsx"), "utf8");

test("iOS audio unlock is a gesture resume, not a CRT path", () => {
  assert.match(unlock, /gestureUnlockAudio/);
  assert.match(unlock, /playSilentTick/);
  assert.match(unlock, /webkitAudioContext/);
  assert.match(unlock, /applyEmuVolume/);
  assert.doesNotMatch(unlock, /getContext/);
  assert.doesNotMatch(unlock, /preserveDrawingBuffer/);
  assert.doesNotMatch(unlock, /lockIosBacking/);
  assert.match(app, /gestureUnlockAudio/);
  assert.match(app, /pointerdown.*gesture|gesture.*pointerdown/);
});
