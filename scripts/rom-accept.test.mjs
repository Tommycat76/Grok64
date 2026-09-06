import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { ROM_ACCEPT, SD_IMAGE_ACCEPT } = await server.ssrLoadModule("/src/lib/emu/formats.ts");
await server.close();

test("ROM_ACCEPT includes .bin and application/octet-stream for iOS Files", () => {
  assert.match(ROM_ACCEPT, /\.bin/);
  assert.match(ROM_ACCEPT, /application\/octet-stream/);
  assert.match(ROM_ACCEPT, /\.rom/);
});

test("SD_IMAGE_ACCEPT includes bin MIME for SD import", () => {
  assert.match(SD_IMAGE_ACCEPT, /\.bin/);
  assert.match(SD_IMAGE_ACCEPT, /application\/octet-stream/);
});
