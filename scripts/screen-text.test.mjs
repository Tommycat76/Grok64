import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});
const { readScreenText, paintScreenLines } = await server.ssrLoadModule("/src/lib/emu/screen-text.ts");
await server.close();

function fakeEmu() {
  const ram = new Uint8Array(65536);
  ram.fill(32, 0x0400, 0x0400 + 1000);
  return {
    ram,
    Module: { grok64WasmApi: { c64Read: (a) => ram[a], c64Write: (a, v) => (ram[a] = v) } },
  };
}

const screenCodes = (s) => [...s].map((ch) => (ch >= "A" && ch <= "Z" ? ch.charCodeAt(0) - 64 : ch.charCodeAt(0)));

test("every screen row reads from its own 40 bytes of screen RAM", () => {
  const emu = fakeEmu();
  for (let row = 0; row < 25; row++) {
    emu.ram.set(screenCodes(`ROW${String(row).padStart(2, "0")}`), 0x0400 + row * 40);
  }
  emu.ram.set(screenCodes("READY."), 0x0400 + 9 * 40);
  const lines = readScreenText(emu).split("\n");
  assert.equal(lines.length, 25);
  assert.equal(lines[9], "READY.");
  assert.equal(lines[8], "ROW08");
  assert.equal(lines[24], "ROW24");
});

test("painted lines land at column 0 of their rows", () => {
  const emu = fakeEmu();
  const want = Array.from({ length: 25 }, (_, i) => `LINE ${i}`);
  paintScreenLines(emu, want);
  assert.deepEqual(readScreenText(emu).split("\n"), want);
});
