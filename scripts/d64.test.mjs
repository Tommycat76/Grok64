import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});
const { prgToD64, wrapForDiskSwap, canSwapKind, t64ToPrg, stripP00 } = await server.ssrLoadModule("/src/lib/emu/d64.ts");
const { d64DiskName, isWorkDiskImage, kindOf } = await server.ssrLoadModule("/src/lib/emu/formats.ts");
await server.close();

const hopper = readFileSync("/workspace/public/software/byte-hopper.prg");
const tape = readFileSync("/workspace/public/software/raster-sid.t64");
const blank = readFileSync("/workspace/public/software/blank.d64");

test("PRG wrap makes a valid 1541 disk that autostart can see", () => {
  const img = prgToD64(new Uint8Array(hopper), "Byte Hopper");
  assert.equal(img.byteLength, 174848);
  assert.equal(d64DiskName(img)?.toUpperCase(), "BYTE HOPPER");
  assert.equal(isWorkDiskImage(img), false);
  const dir = img.subarray(0x16600, 0x16600 + 32);
  assert.equal(dir[2], 0x82);
  assert.ok(dir[3] >= 1 && dir[3] <= 35);
  assert.ok(dir[30] >= 1);
});

test("blank work disk still detects as WORK DISK", () => {
  assert.equal(isWorkDiskImage(new Uint8Array(blank)), true);
});

test("T64 extracts a PRG", () => {
  const prg = t64ToPrg(new Uint8Array(tape));
  assert.ok(prg && prg.byteLength > 4);
  assert.equal(prg[0] | (prg[1] << 8), 0x0801);
});

test("swap wrapper covers disks, programs and tape archives", () => {
  assert.equal(canSwapKind(kindOf("ghostbusters.d64")), true);
  assert.equal(canSwapKind(kindOf("byte-hopper.prg")), true);
  assert.equal(canSwapKind(kindOf("tune.sid")), true);
  assert.equal(canSwapKind(kindOf("demo.t64")), true);
  assert.equal(canSwapKind(kindOf("game.crt")), false);
  const wrapped = wrapForDiskSwap("prg", new Uint8Array(hopper), "Byte Hopper");
  assert.ok(wrapped && wrapped.byteLength === 174848);
  const asDisk = wrapForDiskSwap("d64", new Uint8Array(blank), "WORK DISK");
  assert.equal(asDisk?.byteLength, 174848);
});

test("P00 without a header is rejected", () => {
  assert.equal(stripP00(new Uint8Array([1, 2, 3, 4])), null);
});
