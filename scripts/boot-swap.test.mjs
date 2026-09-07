import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { swapBootDisk, bootFileOf, mountDiskOnUnit, clearUnitMounts, attachAutostartDisk, applyIecUnit, flushEmuFs } =
  await server.ssrLoadModule("/src/lib/emu/host.ts");
const { floppyPlayCanHotSwap } = await server.ssrLoadModule("/src/lib/emu/formats.ts");
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

function mockEmu(fileName, files, vars = new Map()) {
  return {
    fileName,
    gameManager: {
      FS: mockFs(files),
      setVariable: (k, v) => {
        vars.set(k, v);
      },
    },
    __vars: vars,
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

test("attachAutostartDisk forces 1541 unit 8 even after SD2IEC 8_fs", () => {
  clearUnitMounts();
  const vars = new Map([["vice_work_disk", "8_fs"]]);
  const files = new Map([["WORK DISK.D64", new Uint8Array([1])]]);
  const emu = mockEmu("WORK DISK.D64", files, vars);
  applyIecUnit(emu, "sd2iec", 8);
  assert.equal(vars.get("vice_work_disk"), "8_fs");
  const game = new Uint8Array(174848).fill(0x42);
  assert.equal(attachAutostartDisk(emu, game, "Burger_Time.d64", "1541", 8), true);
  assert.equal(vars.get("vice_work_disk"), "8_d64");
  assert.equal(bootFileOf(emu), "WORK DISK.D64");
  assert.equal(files.get("WORK DISK.D64")?.[0], 0x42);
});

test("setVariable 8_d64 after SD2IEC is not a present drive — Play must recycle", () => {
  // Mimic #33: option cache says 8_d64, but the live core is still SD2IEC.
  assert.equal(floppyPlayCanHotSwap("sd2iec", "8_d64"), false);
  assert.equal(floppyPlayCanHotSwap("1541", null), true);
});

test("flushEmuFs waits for delayed IDBFS sync — Autostart must not race mount", async () => {
  let synced = false;
  const emu = {
    gameManager: {
      FS: {
        syncfs: (_populate, cb) => {
          setTimeout(() => {
            synced = true;
            cb();
          }, 80);
        },
      },
    },
  };
  let sawUnsynced = false;
  const pending = flushEmuFs(emu, 500);
  await new Promise((r) => setTimeout(r, 15));
  if (!synced) sawUnsynced = true;
  const ok = await pending;
  assert.equal(ok, true);
  assert.equal(synced, true);
  assert.equal(sawUnsynced, true, "Play would race if it did not await flushEmuFs");
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
