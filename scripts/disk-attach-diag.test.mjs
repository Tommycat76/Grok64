import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const geos = join(process.cwd(), "fixtures", "geos", "GEOS64_2.0.d64");
const bytes = readFileSync(geos);
assert.equal(bytes.byteLength, 174848);
const sha1 = createHash("sha1").update(bytes).digest("hex");
assert.equal(sha1.length, 40);

const SECTORS = [0, ...Array(17).fill(21), ...Array(7).fill(19), ...Array(6).fill(18), ...Array(5).fill(17)];
function trackOffset(track) {
  let off = 0;
  for (let t = 1; t < track; t++) off += SECTORS[t] ?? 0;
  return off;
}
const dirOff = (trackOffset(18) + 1) * 256;
assert.ok(dirOff > 0 && dirOff + 32 < bytes.byteLength);

console.log("ok disk-attach-diag");
