import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const {
  applyJiffyFromRoms,
  injectRoms,
  jiffyPairLanded,
  VICE_SYSTEM_ROOTS,
} = await server.ssrLoadModule("/src/lib/emu/host.ts");
const { romsHaveJiffyPair } = await server.ssrLoadModule("/src/lib/emu/roms.ts");
await server.close();

function mockFs(files = new Map()) {
  return {
    writeFile: (p, d) => {
      files.set(p.replace(/^\//, ""), d);
    },
    readFile: (p) => {
      const key = String(p).replace(/^\//, "");
      const hit = files.get(key);
      if (!hit) throw new Error(`missing ${key}`);
      return hit;
    },
    mkdir: () => undefined,
    stat: (p) => {
      const key = String(p).replace(/^\//, "");
      const hit = files.get(key);
      if (!hit) throw new Error(`missing ${key}`);
      return { mode: 0o100644, size: hit.byteLength };
    },
  };
}

function mockEmu(files = new Map(), vars = new Map()) {
  return {
    gameManager: {
      FS: mockFs(files),
      setVariable: (k, v) => {
        vars.set(k, v);
      },
    },
    __vars: vars,
    __files: files,
  };
}

const pair = {
  "JiffyDOS_C64.bin": new Uint8Array(8192).fill(0x4a),
  "JiffyDOS_1541-II.bin": new Uint8Array(16384).fill(0x44),
};

test("romsHaveJiffyPair requires both C64 and 1541 images", () => {
  assert.equal(romsHaveJiffyPair({}), false);
  assert.equal(romsHaveJiffyPair({ "JiffyDOS_C64.bin": pair["JiffyDOS_C64.bin"] }), false);
  assert.equal(romsHaveJiffyPair(pair), true);
});

test("injectRoms writes the non-userdata system/vice path (CriOS lookup)", () => {
  const emu = mockEmu();
  const n = injectRoms(emu, pair);
  assert.ok(n >= 2);
  assert.ok(VICE_SYSTEM_ROOTS.includes("/home/web_user/retroarch/system/vice"));
  assert.ok(VICE_SYSTEM_ROOTS.includes("/home/web_user/retroarch/userdata/system/vice"));
  const alt = "home/web_user/retroarch/system/vice/JiffyDOS_C64.bin";
  assert.equal(emu.__files.get(alt)?.[0], 0x4a);
  assert.equal(jiffyPairLanded(emu), true);
});

test("applyJiffyFromRoms enables only when both files land", () => {
  const vars = new Map();
  const emu = mockEmu(new Map(), vars);
  assert.equal(applyJiffyFromRoms(emu, true, pair), true);
  assert.equal(vars.get("vice_jiffydos"), "enabled");
  assert.equal(jiffyPairLanded(emu), true);
});

test("applyJiffyFromRoms does not enable when inject writes nothing", () => {
  const vars = new Map();
  const emu = {
    gameManager: {
      FS: { writeFile: () => {
        throw new Error("no fs");
      } },
      setVariable: (k, v) => vars.set(k, v),
    },
  };
  assert.equal(applyJiffyFromRoms(emu, true, pair), false);
  assert.equal(vars.get("vice_jiffydos"), "disabled");
});

test("applyJiffyFromRoms does not enable on C64 ROM only", () => {
  const vars = new Map();
  const emu = mockEmu(new Map(), vars);
  assert.equal(
    applyJiffyFromRoms(emu, true, { "JiffyDOS_C64.bin": pair["JiffyDOS_C64.bin"] }),
    false,
  );
  assert.equal(vars.get("vice_jiffydos"), "disabled");
});

test("want=false disables Jiffy even if ROMs are in the map", () => {
  const vars = new Map();
  const emu = mockEmu(new Map(), vars);
  assert.equal(applyJiffyFromRoms(emu, false, pair), false);
  assert.equal(vars.get("vice_jiffydos"), "disabled");
});
