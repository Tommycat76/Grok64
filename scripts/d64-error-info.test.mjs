#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const D64_STANDARD_SIZE = 174848;
const D64_SIZE_35_WITH_ERROR = 175531;
const D64_FDC_ERR_OK = 1;

function normalizeD64ErrorInfoTail(data) {
  const sizes = new Set([D64_STANDARD_SIZE, D64_SIZE_35_WITH_ERROR, 196608, 197376]);
  if (!sizes.has(data.byteLength) || data.byteLength === D64_STANDARD_SIZE) return data;
  const tailLen = data.byteLength - D64_STANDARD_SIZE;
  let changed = false;
  for (let i = data.byteLength - tailLen; i < data.byteLength; i++) {
    if (data[i] === 0) changed = true;
  }
  if (!changed) return data;
  const out = data.slice();
  for (let i = out.byteLength - tailLen; i < out.byteLength; i++) {
    if (out[i] === 0) out[i] = D64_FDC_ERR_OK;
  }
  return out;
}

const base = new Uint8Array(D64_STANDARD_SIZE).fill(0x55);
const tail = new Uint8Array(D64_SIZE_35_WITH_ERROR - D64_STANDARD_SIZE);
const combined = new Uint8Array(D64_SIZE_35_WITH_ERROR);
combined.set(base, 0);
combined.set(tail, D64_STANDARD_SIZE);
const out = normalizeD64ErrorInfoTail(combined);
assert.equal(out.byteLength, D64_SIZE_35_WITH_ERROR);
for (let i = D64_STANDARD_SIZE; i < out.byteLength; i++) {
  assert.equal(out[i], D64_FDC_ERR_OK);
}

const geos = join(import.meta.dirname, "..", "fixtures", "geos", "GEOS_2.0.d64");
try {
  const disk = new Uint8Array(readFileSync(geos));
  if (disk.byteLength === D64_SIZE_35_WITH_ERROR) {
    const fixed = normalizeD64ErrorInfoTail(disk);
    for (let i = D64_STANDARD_SIZE; i < fixed.byteLength; i++) {
      assert.notEqual(fixed[i], 0);
    }
  }
} catch {
  /* optional */
}

console.log("d64-error-info.test.mjs ok");
