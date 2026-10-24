import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createServer } from "vite";
import { cartFixturePath, CART_COMPAT_CATALOG } from "./cart-compat-catalog.mjs";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
await server.pluginContainer.buildStart({});
const { detectFastLoadCart, detectFastLoadCartFromPayload } = await server.ssrLoadModule(
  "/src/lib/emu/jiffy-cart-compat.ts",
);
await server.close();

const ss5 = readFileSync(cartFixturePath(CART_COMPAT_CATALOG.find((c) => c.id === "ss5")));

test("IndexedDB-style basename without .crt still detects SS5 from CRT bytes", () => {
  assert.equal(detectFastLoadCart("saved-ss5-dump", null), null);
  assert.equal(detectFastLoadCartFromPayload(ss5, "saved-ss5-dump", null), "super-snapshot-5");
});
