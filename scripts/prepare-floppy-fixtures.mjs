#!/usr/bin/env node
/**
 * fixtures/geos/GEOS_2.0.d64 (175531, error-info table) for QA: a copy of the real image
 * from GROK64_GEOS_D64_PATH or private-c64/geos. Nothing is synthesized; without a real
 * copy the scripts that need GEOS_2.0.d64 skip.
 */
import { ensureGeosD64Fixture } from "./geos-fixture-lib.mjs";

const res = ensureGeosD64Fixture();
if (res.missing) {
  console.warn("GEOS_2.0.d64 not available (set GROK64_GEOS_D64_PATH or add it to private-c64/geos):", res.source);
  process.exit(0);
}
const { out, source, bytes, sha1, tomHand, bamName, errorCodes } = res;
console.log("ok", out, JSON.stringify({ source, bytes, sha1, tomHand, bamName, errorCodes }));
