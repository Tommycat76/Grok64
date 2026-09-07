import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { frameLooksReady, viceScreenshot } = await server.ssrLoadModule("/src/lib/emu/ios-paint.ts");
await server.close();

function fakePng(n = 400) {
  const u8 = new Uint8Array(n);
  u8[0] = 0x89;
  u8[1] = 0x50;
  u8[2] = 0x4e;
  u8[3] = 0x47;
  return u8;
}

function mockEmu(files = new Map(), opts = {}) {
  let cmds = 0;
  const emu = {
    gameManager: {
      FS: {
        readFile: (p) => {
          const key = String(p).replace(/^\//, "");
          const hit = files.get(key);
          if (!hit) throw new Error(`missing ${key}`);
          return hit;
        },
        unlink: (p) => {
          files.delete(String(p).replace(/^\//, ""));
        },
      },
      functions: {
        screenshot: () => {
          cmds += 1;
          if (opts.onCmd) opts.onCmd(files, cmds);
        },
      },
    },
    cmds: () => cmds,
  };
  return emu;
}

test("frameLooksReady accepts BASIC READY-like metrics", () => {
  assert.equal(frameLooksReady({ lum: 48, uniq: 6 }), true);
  assert.equal(frameLooksReady({ lum: 90, uniq: 8 }), true);
});

test("frameLooksReady rejects black, thin, and GL garbage", () => {
  assert.equal(frameLooksReady(null), false);
  assert.equal(frameLooksReady({ lum: 2, uniq: 1 }), false);
  assert.equal(frameLooksReady({ lum: 20, uniq: 1 }), false);
  assert.equal(frameLooksReady({ lum: 80, uniq: 80 }), false);
  assert.equal(frameLooksReady({ lum: 180, uniq: 30 }), false);
});

test("viceScreenshot times out instead of hanging when PNG never appears", async () => {
  const emu = mockEmu();
  const t0 = Date.now();
  const raw = await viceScreenshot(emu, 120);
  assert.equal(raw, null);
  assert.equal(emu.cmds(), 1);
  assert.ok(Date.now() - t0 < 900, "timed-out screenshot must not spin");
});

test("viceScreenshot returns the PNG after cmd_take_screenshot", async () => {
  const png = fakePng();
  const emu = mockEmu(new Map(), {
    onCmd: (files) => {
      files.set("screenshot.png", png);
    },
  });
  const raw = await viceScreenshot(emu, 200);
  assert.ok(raw && raw[0] === 0x89 && raw.byteLength >= 350);
  assert.equal(emu.cmds(), 1);
});

test("viceScreenshot serializes overlapping callers (no second hang)", async () => {
  const png = fakePng();
  const emu = mockEmu(new Map(), {
    onCmd: (files) => {
      files.set("screenshot.png", png);
    },
  });
  const [a, b] = await Promise.all([viceScreenshot(emu, 200), viceScreenshot(emu, 200)]);
  assert.ok(a && a.byteLength >= 350);
  assert.ok(b && b.byteLength >= 350);
  assert.equal(emu.cmds(), 2);
});
