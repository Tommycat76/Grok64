import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const {
  d81DiskName,
  floppyDiskName,
  floppyMechanismFor,
  iecForAutostart,
  isAcceptedD81ByteLength,
  kindOf,
} = await server.ssrLoadModule("/src/lib/emu/formats.ts");
const { floppyInsertRejection } = await server.ssrLoadModule("/src/lib/emu/play-session.ts");
const { attachesOwnImageOnly, driveTypeForAttach } = await server.ssrLoadModule("/src/lib/emu/vice-disk.ts");
await server.close();

const MAP_1541 = { 8: "1541", 9: "none", 10: "none", 11: "none" };
const MAP_1581 = { 8: "1581", 9: "none", 10: "none", 11: "none" };
const MAP_CMDHD = { 8: "1541", 9: "cmdhd", 10: "none", 11: "none" };

function namedD81(label) {
  const data = new Uint8Array(819200);
  const off = 39 * 40 * 256 + 4;
  const name = label.toUpperCase().padEnd(16, "\xa0").slice(0, 16);
  for (let i = 0; i < 16; i++) data[off + i] = name.charCodeAt(i);
  return data;
}

test("D81 is a 1581 disk; D64/G64 stay on the 1541; D71/G71 need a 1571", () => {
  assert.equal(floppyMechanismFor(kindOf("geo.d81")), "1581");
  assert.equal(floppyMechanismFor(kindOf("boot.d64")), "1541");
  assert.equal(floppyMechanismFor(kindOf("track.g64")), "1541");
  assert.equal(floppyMechanismFor(kindOf("side.d71")), "1571");
  assert.equal(floppyMechanismFor(kindOf("side.g71")), "1571");
  assert.deepEqual(iecForAutostart(kindOf("GEOWrite.d81")), { iec: "1581", unit: 8 });
});

test("library Insert refuses a D81 unless that unit is a 1581, and refuses a D64 on a 1581", () => {
  assert.match(floppyInsertRejection("d81", MAP_1541, 8), /1581/);
  assert.match(floppyInsertRejection("d81", MAP_CMDHD, 8), /1581/);
  assert.match(floppyInsertRejection("d81", MAP_CMDHD, 9), /CMD HD/);
  assert.equal(floppyInsertRejection("d81", MAP_1581, 8), null);
  assert.match(floppyInsertRejection("d64", MAP_1581, 8), /1541/);
  assert.match(floppyInsertRejection("g64", MAP_1581, 8), /1541/);
  assert.equal(floppyInsertRejection("d64", MAP_1541, 8), null);
  assert.match(floppyInsertRejection("d71", MAP_1541, 8), /1571/);
});

test("driveTypeForAttach only switches the live drive when the image needs it", () => {
  assert.equal(driveTypeForAttach("d81", 1541), 1581);
  assert.equal(driveTypeForAttach("d81", 1542), 1581);
  assert.equal(driveTypeForAttach("d81", 1581), null);
  assert.equal(driveTypeForAttach("d81", 2000), null);
  assert.equal(driveTypeForAttach("d81", 4000), null);
  assert.equal(driveTypeForAttach("d64", 1581), 1541);
  assert.equal(driveTypeForAttach("d64", 4844), 1541);
  assert.equal(driveTypeForAttach("d64", 1541), null);
  assert.equal(driveTypeForAttach("d64", 1542), null);
  assert.equal(driveTypeForAttach("d64", 0), null);
  assert.equal(driveTypeForAttach("g64", 1581), 1541);
  assert.equal(driveTypeForAttach("d71", 1541), null);
});

test("D81 header name is at track 40; attach paths never fall back to a stale D64", () => {
  const img = namedD81("SWAP TEST");
  assert.equal(isAcceptedD81ByteLength(img.byteLength), true);
  assert.equal(d81DiskName(img), "SWAP TEST");
  assert.equal(floppyDiskName(img), "SWAP TEST");
  assert.equal(attachesOwnImageOnly("d81"), true);
  assert.equal(attachesOwnImageOnly("g64"), true);
  assert.equal(attachesOwnImageOnly("d64"), false);
});
