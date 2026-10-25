#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { d64ErrorInfoSummary } from "./d64-error-info-lib.mjs";

/** Tom hand-signoff GEOS_2.0.d64 (175531, error-info tail) — prefix match. */
export const TOM_GEOS_D64_SHA1_PREFIX = "c2162953";
export const GEOS_D64_EXPECTED_BYTES = 175531;

/**
 * English GEOS 64 2.0 boot disk (BAM "System", GEOS64.D64 from Click Here Software's
 * GEOS64.ZIP), fetched by scripts/fetch-fixtures.mjs. Free to use but not to
 * redistribute: fixtures/ only.
 */
export const GEOS_EN_PLAIN_NAME = "GEOS64_en.d64";

export function sha1Hex(buf) {
  return createHash("sha1").update(buf).digest("hex");
}

export function resolveGeosD64Path(cwd = process.cwd()) {
  const envPath = process.env.GROK64_GEOS_D64_PATH;
  if (envPath && existsSync(envPath)) return envPath;
  const geosDir = process.env.GROK64_GEOS_DIR || join(cwd, "private-c64", "geos");
  const fromPrivate = join(geosDir, "GEOS_2.0.d64");
  if (existsSync(fromPrivate)) return fromPrivate;
  return join(cwd, "fixtures", "geos", "GEOS_2.0.d64");
}

export function geosD64Fingerprint(buf) {
  const bam = buf.byteLength >= 174848 ? buf.subarray(91392, 91392 + 256) : null;
  let bamName = null;
  if (bam) {
    let end = 0xa0;
    while (end > 0x90 && bam[end - 1] === 0xa0) end--;
    bamName = Buffer.from(bam.subarray(0x90, end)).toString("latin1");
  }
  const info = d64ErrorInfoSummary(buf);
  return {
    bytes: buf.byteLength,
    sha1: sha1Hex(buf),
    tomHand: sha1Hex(buf).startsWith(TOM_GEOS_D64_SHA1_PREFIX),
    bamName,
    errorCodes: info.errorInfo ? info.badCount : 0,
  };
}

/**
 * fixtures/geos/GEOS_2.0.d64 is only ever a copy of a real 175531-byte image
 * (GROK64_GEOS_D64_PATH, or GEOS_2.0.d64 in GROK64_GEOS_DIR, default private-c64/geos).
 * Nothing is synthesized: gates must run on the exact media they name.
 */
export function ensureGeosD64Fixture(cwd = process.cwd()) {
  const outDir = join(cwd, "fixtures", "geos");
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, "GEOS_2.0.d64");
  const src = resolveGeosD64Path(cwd);
  if (existsSync(src) && src !== out) {
    const buf = readFileSync(src);
    if (buf.byteLength === GEOS_D64_EXPECTED_BYTES) {
      copyFileSync(src, out);
      return { out, ...geosD64Fingerprint(buf), source: src, copied: true };
    }
  }
  if (existsSync(out)) {
    const buf = readFileSync(out);
    return { out, ...geosD64Fingerprint(buf), source: out };
  }
  return { out, source: src, missing: true };
}
