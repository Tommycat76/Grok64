import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { buildSd2iecVolume, estimateSd2iecBlocks, D64_BLOCK_BUDGET } = await server.ssrLoadModule(
  "/src/lib/emu/sd2iec-volume.ts",
);
await server.close();

function prgPayload(bytes) {
  const out = new Uint8Array(bytes + 2);
  out[0] = 0x01;
  out[1] = 0x08;
  for (let i = 2; i < out.length; i++) out[i] = (i * 17) & 0xff;
  return out;
}

test("small SD folder packs D64", () => {
  const parts = [
    {
      id: 0,
      files: [{ name: "A.PRG", path: "", data: prgPayload(200).buffer }],
    },
  ];
  const vol = buildSd2iecVolume(parts);
  assert.equal(vol.format, "d64");
  assert.equal(vol.driveType, "1541");
  assert.equal(vol.data.byteLength, 174848);
});

test("folder over D64 budget builds 1581 D81 (>800 blocks)", () => {
  const parts = [
    {
      id: 0,
      files: [{ name: "C64OS.PRG", path: "C64OS", data: prgPayload(810 * 254).buffer }],
    },
  ];
  assert.ok(estimateSd2iecBlocks(parts) > 800);
  const vol = buildSd2iecVolume(parts);
  assert.equal(vol.format, "d81");
  assert.equal(vol.driveType, "1581");
  assert.equal(vol.data.byteLength, 819200);
  assert.ok(vol.blocksUsed > 800);
});
