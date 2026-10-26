import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const {
  D64_STANDARD_SIZE,
  d64HasBamDiskLabel,
  d64HasDirectoryEntries,
  isLikelyBlankD64Payload,
  isDiskKind,
  kindOf,
} = await server.ssrLoadModule("/src/lib/emu/formats.ts");
const { validateFloppyLibraryPayload } = await server.ssrLoadModule("/src/lib/emu/disk-attach-diag.ts");
const { prgToD64 } = await server.ssrLoadModule("/src/lib/emu/d64.ts");
const { libraryRowAllowsDiskWriteBack } = await server.ssrLoadModule("/src/lib/emu/library-writeback.ts");
await server.close();

const D64_BAM = 17 * 21 * 256;

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

test("real-shaped d64 with zeros in low tracks but BAM label is not blank", () => {
  const hopper = prgToD64(new Uint8Array([0x01, 0x08, 0x0a, 0x00, 0x9e, 0x34, 0x0d, 0x08]), "BYTE HOPPER");
  assert.equal(d64HasBamDiskLabel(hopper), true);
  assert.equal(d64HasDirectoryEntries(hopper), true);
  assert.equal(isLikelyBlankD64Payload(hopper), false);
  assert.deepEqual(validateFloppyLibraryPayload("byte-hopper.d64", hopper), { ok: true });
  const jollyLike = new Uint8Array(D64_STANDARD_SIZE);
  const label = "JOLLYDISK SIDE 1";
  for (let i = 0; i < label.length; i++) jollyLike[D64_BAM + 0x90 + i] = label.charCodeAt(i);
  jollyLike[D64_BAM] = 18;
  jollyLike[D64_BAM + 1] = 1;
  const dirOff = 0x16600;
  jollyLike[dirOff + 2] = 0x82;
  assert.equal(d64HasBamDiskLabel(jollyLike), true);
  assert.equal(isLikelyBlankD64Payload(jollyLike), false);
  assert.deepEqual(validateFloppyLibraryPayload("JollyDisk Xmas.d64", jollyLike), { ok: true });
});
