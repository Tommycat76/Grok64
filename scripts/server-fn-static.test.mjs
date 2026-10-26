import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { asArray, callServerFnFirst } = await server.ssrLoadModule("/src/lib/server-fn-static.ts");
await server.close();

test("asArray coerces undefined to []", () => {
  assert.deepEqual(asArray(undefined), []);
  assert.deepEqual(asArray([1]), [1]);
});

test("callServerFnFirst returns empty when both fail", async () => {
  const out = await callServerFnFirst(
    async () => {
      throw new Error("client");
    },
    async () => {
      throw new Error("server");
    },
    { hits: [] },
  );
  assert.deepEqual(out, { hits: [] });
});

test("callServerFnFirst uses server result outside the browser", async () => {
  const out = await callServerFnFirst(
    async () => ({ hits: ["a"] }),
    async () => ({ hits: ["b"] }),
    { hits: [] },
  );
  assert.deepEqual(out.hits, ["b"]);
});
