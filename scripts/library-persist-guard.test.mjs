import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { D64_STANDARD_SIZE, isLikelyBlankD64Payload, isDiskKind, kindOf } =
  await server.ssrLoadModule("/src/lib/emu/formats.ts");
const { libraryRowAllowsDiskWriteBack } = await server.ssrLoadModule("/src/lib/emu/library-writeback.ts");
await server.close();

test("isLikelyBlankD64Payload detects zeroed 35-track image", () => {
  const blank = new Uint8Array(D64_STANDARD_SIZE);
  assert.equal(isLikelyBlankD64Payload(blank), true);
});

test("CRT bytes are not treated as blank d64", () => {
  const crt = new Uint8Array(8192);
  const sig = "C64 CARTRIDGE   ";
  for (let i = 0; i < 16; i++) crt[i] = sig.charCodeAt(i);
  assert.equal(isLikelyBlankD64Payload(crt), false);
});

test("only disk kinds are eligible for floppy autosave rows", () => {
  assert.equal(isDiskKind(kindOf("game.crt")), false);
  assert.equal(isDiskKind(kindOf("game.d64")), true);
});

test("libraryRowAllowsDiskWriteBack rejects blank d64 into crt name", () => {
  const blank = new Uint8Array(D64_STANDARD_SIZE);
  assert.equal(libraryRowAllowsDiskWriteBack("Super_Snapshot_v5.crt", blank), false);
});
