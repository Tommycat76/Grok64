import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { sidOptions } = await server.ssrLoadModule("/src/lib/emu/machines.ts");
await server.close();

test("single SID default matches stock (no extras)", () => {
  const o = sidOptions({
    engine: "ReSID",
    model: "6581",
    sid2: "disabled",
    sid2Model: "default",
    sid3: "disabled",
    sid3Model: "default",
  });
  assert.equal(o.vice_sid_extra, "disabled");
  assert.equal(o.vice_sid_extra2, "disabled");
  assert.equal(o.vice_sid_model, "6581");
  assert.equal(o.vice_sid_model2, undefined);
});

test("stereo + triple SID addresses map to VICE options", () => {
  const o = sidOptions({
    engine: "ReSID",
    model: "default",
    sid2: "0xde00",
    sid2Model: "8580",
    sid3: "0xd420",
    sid3Model: "6581",
  });
  assert.equal(o.vice_sid_extra, "0xde00");
  assert.equal(o.vice_sid_model2, "8580");
  assert.equal(o.vice_sid_extra2, "0xd420");
  assert.equal(o.vice_sid_model3, "6581");
});
