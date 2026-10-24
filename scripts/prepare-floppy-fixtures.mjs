#!/usr/bin/env node
/** Build GEOS_2.0.d64 (175531) from bundled GEOS64 + 683-byte error tail for QA. */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const geosDir = join(process.cwd(), "fixtures", "geos");
mkdirSync(geosDir, { recursive: true });
const src = join(geosDir, "GEOS64_2.0.d64");
const out = join(geosDir, "GEOS_2.0.d64");
const tailPath = join(geosDir, "d64-error-tail-683.bin");

if (!existsSync(src)) {
  console.error("missing", src);
  process.exit(1);
}
const base = readFileSync(src);
if (base.byteLength === 175531) {
  copyFileSync(src, out);
  console.log("ok", out, "already 175531");
  process.exit(0);
}
if (base.byteLength !== 174848) {
  console.error("unexpected GEOS64 size", base.byteLength);
  process.exit(1);
}
let tail;
if (existsSync(tailPath)) {
  tail = readFileSync(tailPath);
} else {
  tail = Buffer.alloc(683, 0);
  writeFileSync(tailPath, tail);
}
if (tail.byteLength !== 683) {
  console.error("error tail must be 683 bytes");
  process.exit(1);
}
const combined = Buffer.concat([base, tail]);
writeFileSync(out, combined);
console.log("ok", out, combined.byteLength);
