import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { swapBootDisk, bootFileOf, mountDiskOnUnit, clearUnitMounts } = await server.ssrLoadModule(
  "/src/lib/emu/host.ts",
);
await server.close();

function mockFs(files = new Map()) {
  return {
    writeFile: (p, d) => {
      files.set(p.replace(/^\//, ""), d);
    },
    readFile: (p) => files.get(p.replace(/^\//, "")),
    readdir: (p) => (p === "/" ? [...files.keys()] : []),
    stat: () => ({ mode: 0o100644 }),
    unlink: (p) => {
      files.delete(p.replace(/^\//, ""));
    },
  };
}

function mockEmu(fileName, files) {
  return {
    fileName,
    gameManager: { FS: mockFs(files) },
  };
}

test("swapBootDisk overwrites current boot file for autostart", () => {
  clearUnitMounts();
  const files = new Map([["WORK DISK.D64", new Uint8Array([1])]]);
  const emu = mockEmu("WORK DISK.D64", files);
  const game = new Uint8Array(174848).fill(0x42);
  assert.equal(swapBootDisk(emu, game, "Paradroid.d64"), true);
  assert.equal(bootFileOf(emu), "WORK DISK.D64");
  assert.equal(files.get("WORK DISK.D64")?.[0], 0x42);
  assert.equal(files.has("Paradroid.d64"), false);
});

test("mountDiskOnUnit keeps boot file when pruning extras", () => {
  clearUnitMounts();
  const stub = new Uint8Array(256).fill(1);
  const files = new Map([
    ["WORK DISK.D64", stub],
    ["old-game.d64", new Uint8Array(256).fill(2)],
  ]);
  const emu = mockEmu("WORK DISK.D64", files);
  const game = new Uint8Array(174848).fill(0x55);
  assert.equal(mountDiskOnUnit(emu, 9, game, "sideb.d64", "1541"), true);
  assert.equal(files.has("WORK DISK.D64"), true);
  assert.equal(files.has("old-game.d64"), false);
  assert.equal(files.get("sideb.d64")?.[0], 0x55);
});
