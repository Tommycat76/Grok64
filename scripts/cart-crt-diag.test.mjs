import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { parseCrtHeader, validateCartForPlay, validateCrtImport, formatHeaderHex64 } =
  await server.ssrLoadModule(
  "/src/lib/emu/cart-crt-diag.ts",
);
await server.close();

function fakeCrt(extra = 0) {
  const buf = new Uint8Array(8192 + extra);
  const sig = "C64 CARTRIDGE   ";
  for (let i = 0; i < 16; i++) buf[i] = sig.charCodeAt(i);
  const name = "SUPER SNAPSHOT 5";
  for (let i = 0; i < name.length; i++) buf[16 + i] = name.charCodeAt(i);
  buf[32] = 1;
  buf[33] = 0;
  buf[34] = 26;
  buf[35] = 1;
  buf[36] = 0;
  return buf;
}

test("parseCrtHeader accepts VICE-style header", () => {
  const h = parseCrtHeader(fakeCrt());
  assert.equal(h.valid, true);
  assert.match(h.signature ?? "", /C64 CARTRIDGE/);
  assert.equal(h.hwTypeId, 26);
});

test("validateCartForPlay rejects truncated CRT", () => {
  const tiny = fakeCrt().subarray(0, 200);
  const v = validateCartForPlay(tiny, "test.crt");
  assert.equal(v.ok, false);
});

test("validateCartForPlay rejects IDB size mismatch", () => {
  const v = validateCartForPlay(fakeCrt(), "test.crt", 999_999);
  assert.equal(v.ok, false);
});

test("formatHeaderHex64 returns 64 bytes hex", () => {
  const hex = formatHeaderHex64(fakeCrt());
  assert.equal(hex.split(" ").length, 64);
});

test("validateCrtImport rejects bad CRT on import", () => {
  assert.match(validateCrtImport(fakeCrt().subarray(0, 100), "x.crt") ?? "", /truncated/i);
  assert.equal(validateCrtImport(fakeCrt(), "x.crt"), null);
  assert.equal(validateCrtImport(fakeCrt(), "game.d64"), null);
  assert.equal(validateCrtImport(fakeCrt(), "saved-ss5-dump"), null);
  assert.match(validateCrtImport(fakeCrt().subarray(0, 100), "saved-ss5-dump") ?? "", /truncated/i);
});
