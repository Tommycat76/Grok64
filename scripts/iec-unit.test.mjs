import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { workDiskFor } = await server.ssrLoadModule("/src/lib/emu/vice-extras.ts");
const { iecForAutostart, kindOf } = await server.ssrLoadModule("/src/lib/emu/formats.ts");
await server.close();

test("workDiskFor maps IEC storage modes to VICE work-disk units", () => {
  assert.equal(workDiskFor("sd2iec", 8), "8_fs");
  assert.equal(workDiskFor("sd2iec", 11), "11_fs");
  assert.equal(workDiskFor("cmdhd", 9), "9_fs");
  assert.equal(workDiskFor("1581", 10), "10_d81");
  assert.equal(workDiskFor("1541", 8), "8_d64");
  assert.equal(workDiskFor("1541", 9), "9_d64");
  assert.equal(workDiskFor("1541", 11), "11_d64");
});

test("floppy Play attaches 1541/1581 on unit 8 — never SD2IEC 8_fs", () => {
  assert.deepEqual(iecForAutostart(kindOf("Burger_Time_1983.d64")), { iec: "1541", unit: 8 });
  assert.deepEqual(iecForAutostart(kindOf("paradroid.d64")), { iec: "1541", unit: 8 });
  assert.deepEqual(iecForAutostart(kindOf("uridiumfcs.d64")), { iec: "1541", unit: 8 });
  assert.deepEqual(iecForAutostart(kindOf("sideb.d81")), { iec: "1581", unit: 8 });
  assert.equal(iecForAutostart(kindOf("game.crt")), null);
  assert.equal(workDiskFor(iecForAutostart(kindOf("Burger_Time.d64")).iec, 8), "8_d64");
});
