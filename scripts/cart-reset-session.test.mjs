import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { setSessionCart, sessionCartSlot, clearSessionMedia } = await server.ssrLoadModule(
  "/src/lib/emu/session-media.ts",
);
await server.close();

test("session cart slot survives for reset reattach", () => {
  clearSessionMedia();
  const bytes = new Uint8Array([0x43, 0x36, 0x34, 0x20]);
  setSessionCart("SS5NTSC.crt", bytes);
  const slot = sessionCartSlot();
  assert.ok(slot);
  assert.equal(slot.name, "SS5NTSC.crt");
  assert.equal(slot.bytes.byteLength, 4);
  assert.equal(slot.kind, "cart");
});
