import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const {
  detectFastLoadCart,
  jiffyCartCompat,
  resolveJiffyWant,
  JIFFY_FASTLOAD_CART_MATRIX,
} = await server.ssrLoadModule("/src/lib/emu/jiffy-cart-compat.ts");
await server.close();

test("detects known fast-load carts", () => {
  assert.equal(detectFastLoadCart("Action Replay 6.crt"), "action-replay");
  assert.equal(detectFastLoadCart("Super_Snapshot_v4.0_1989_NTSC.crt"), "super-snapshot-4");
  assert.equal(detectFastLoadCart("supersnapshot-v5.crt"), "super-snapshot-5");
  assert.equal(detectFastLoadCart("Final Cartridge III.bin"), "final-cartridge-3");
  assert.equal(detectFastLoadCart("Epyx_Fast_Load.crt"), "epyx-fastload");
  assert.equal(detectFastLoadCart("boulder.d64"), null);
});

test("Super Snapshot suppresses Jiffy (hardware incompatible)", () => {
  for (const cart of ["super-snapshot-4", "super-snapshot-5"]) {
    const c = jiffyCartCompat(cart, true);
    assert.equal(c.level, "incompatible");
    assert.equal(c.suppressJiffy, true);
    assert.equal(resolveJiffyWant(true, cart), false);
  }
});

test("Action Replay suppresses Jiffy for reliable freezer boot", () => {
  const c = jiffyCartCompat("action-replay", true);
  assert.equal(c.level, "caution");
  assert.equal(c.suppressJiffy, true);
  assert.equal(resolveJiffyWant(true, "action-replay"), false);
});

test("FC3 is compatible", () => {
  assert.equal(jiffyCartCompat("final-cartridge-3", true).level, "compatible");
});

test("matrix documents all cart families", () => {
  assert.ok(JIFFY_FASTLOAD_CART_MATRIX.length >= 6);
});
