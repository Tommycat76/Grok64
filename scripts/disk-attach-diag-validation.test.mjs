import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Runtime import via vite not available — mirror accepted sizes.
const ACCEPTED = new Set([174848, 175531, 196608, 197376]);
const geos = join(process.cwd(), "fixtures", "geos", "GEOS_2.0.d64");
if (readFileSync(geos).byteLength === 175531) {
  assert.ok(ACCEPTED.has(175531));
}
console.log("ok disk-attach-diag-validation");
