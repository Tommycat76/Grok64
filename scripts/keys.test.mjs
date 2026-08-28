import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});
const { c64Keystrokes } = await server.ssrLoadModule("/src/lib/emu/keys.ts");
const { needsTypedBoot, kindOf, driveForPlay, isDiskKind } = await server.ssrLoadModule("/src/lib/emu/formats.ts");
await server.close();

test("LOAD *,8,1 keystrokes match the C64 keyboard", () => {
  const strokes = c64Keystrokes('LOAD"*",8,1\n');
  assert.deepEqual(
    strokes.map((s) => ({ code: s.code, key: s.key, shift: s.shift })),
    [
      { code: "KeyL", key: "l", shift: false },
      { code: "KeyO", key: "o", shift: false },
      { code: "KeyA", key: "a", shift: false },
      { code: "KeyD", key: "d", shift: false },
      { code: "Digit2", key: '"', shift: true },
      { code: "BracketRight", key: "*", shift: false },
      { code: "Digit2", key: '"', shift: true },
      { code: "Comma", key: ",", shift: false },
      { code: "Digit8", key: "8", shift: false },
      { code: "Comma", key: ",", shift: false },
      { code: "Digit1", key: "1", shift: false },
      { code: "Enter", key: "Enter", shift: false },
    ],
  );
});

test("RUN keystrokes", () => {
  const strokes = c64Keystrokes("RUN\n");
  assert.deepEqual(
    strokes.map((s) => s.code),
    ["KeyR", "KeyU", "KeyN", "Enter"],
  );
});

test("disks use the disk load path; carts and PRGs do not", () => {
  assert.equal(needsTypedBoot(kindOf("boulderdash-awally.d64")), true);
  assert.equal(needsTypedBoot(kindOf("paradroidalldrives.d64")), true);
  assert.equal(needsTypedBoot(kindOf("game.crt")), false);
  assert.equal(needsTypedBoot(kindOf("byte-hopper.prg")), false);
  assert.equal(needsTypedBoot(kindOf("tune.sid")), false);
});

test("disk games force a real 1541 so custom loaders do not freeze", () => {
  assert.equal(driveForPlay("fast", { typedDisk: true }), "true");
  assert.equal(driveForPlay("fast", { typedDisk: true, workDisk: true }), "fast");
  assert.equal(driveForPlay("fast", { workDisk: true }), "fast");
  assert.equal(driveForPlay("true", { typedDisk: false }), "true");
});

test("only floppy images can be inserted as a second disk", () => {
  assert.equal(isDiskKind(kindOf("ninja-disk2.d64")), true);
  assert.equal(isDiskKind(kindOf("sideb.g64")), true);
  assert.equal(isDiskKind(kindOf("byte-hopper.prg")), false);
  assert.equal(isDiskKind(kindOf("tune.sid")), false);
});
