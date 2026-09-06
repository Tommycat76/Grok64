import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { workDiskFor } = await server.ssrLoadModule("/src/lib/emu/vice-extras.ts");
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
