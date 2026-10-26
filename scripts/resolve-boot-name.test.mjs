import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
await server.pluginContainer.buildStart({});
const { resolvePlayBootName, isCartridgePayload } = await server.ssrLoadModule("/src/lib/emu/formats.ts");
await server.close();

function crtHeader() {
  const u = new Uint8Array(64);
  u.set([...new TextEncoder().encode("C64 CARTRIDGE")]);
  return u;
}

test("CRT bytes with .d64 boot name resolve to .crt", () => {
  const data = crtHeader();
  const name = resolvePlayBootName("mystery.d64", data, null);
  assert.match(name, /\.crt$/i);
  assert.equal(isCartridgePayload(data, name), true);
});

test("explicit .crt name kept", () => {
  const data = crtHeader();
  assert.equal(resolvePlayBootName("ss5.crt", data, null), "ss5.crt");
});
