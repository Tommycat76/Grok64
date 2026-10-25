import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const {
  bindGrok64DiskApiDirect,
  grok64DiskAttachInvocable,
  exportIdentPresent,
} = await server.ssrLoadModule("/src/lib/emu/grok64-wasm-direct.ts");
const { prepareDriveForAttach, driveTypeForAttach } = await server.ssrLoadModule("/src/lib/emu/vice-disk.ts");
await server.close();

test("a numeric wasm ident is still invocable when ccall exists", () => {
  const mod = { grok64_disk_attach: 42, ccall: () => 0 };
  assert.equal(exportIdentPresent(mod, "grok64_disk_attach"), true);
  assert.equal(grok64DiskAttachInvocable(mod), true);
});

test("Insert attach uses the raw export even when ccall returns -99", () => {
  const heap = new Uint8Array(4096);
  let next = 32;
  const calls = [];
  const mod = {
    _grok64_disk_attach: (unit, drive, ptr) => {
      calls.push({ unit, drive, ptr });
      return 0;
    },
    ccall: () => -99,
    allocateUTF8: (str) => {
      const p = next;
      next += 64;
      return p;
    },
    _free: () => {},
    HEAPU8: heap,
  };
  assert.equal(bindGrok64DiskApiDirect(mod), true);
  assert.equal(mod.grok64DiskApi.diskAttach(8, 0, "/data/saves/grok64_iec8.d64"), 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].unit, 8);
});

test("Insert attach falls back to 3-arg ccall when the raw export is missing", () => {
  const calls = [];
  const mod = {
    grok64_disk_attach: 7,
    ccall: (name, _ret, types, args) => {
      calls.push({ name, types, args });
      return name === "grok64_disk_attach" ? 0 : -99;
    },
  };
  assert.equal(grok64DiskAttachInvocable(mod), true);
  assert.equal(bindGrok64DiskApiDirect(mod), true);
  assert.equal(mod.grok64DiskApi.diskAttach(8, 0, "/data/saves/vice_work.d64"), 0);
  assert.equal(calls[0].name, "grok64_disk_attach");
  assert.deepEqual(calls[0].types, ["number", "number", "string"]);
  assert.deepEqual(calls[0].args, [8, 0, "/data/saves/vice_work.d64"]);
});

test("a missing driveSetType helper does not invent rc=-99 for a d64 on a 1541", () => {
  assert.equal(driveTypeForAttach("d64", 1541), null);
  assert.equal(prepareDriveForAttach({ Module: {} }, 8, "/data/saves/vice_work.d64"), 0);
});

test("driveSetType wrapper rc=-99 does not abort attach", () => {
  const mod = {
    grok64DiskApi: {
      diskAttach: () => 0,
      driveSetType: () => -99,
      driveUnitType: () => 4844,
    },
    _grok64_disk_attach: () => 0,
  };
  assert.equal(prepareDriveForAttach({ Module: mod }, 8, "/data/saves/geos.d64"), 0);
});
