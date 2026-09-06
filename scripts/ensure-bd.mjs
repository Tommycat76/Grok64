#!/usr/bin/env node
/**
 * Cache the pinned Boulder Dash disk into dist/software for static hosts.
 * Internet Archive blocks browser CORS on CDN nodes; server-side fetch at build time fixes catalog play.
 */
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] || "dist";
const outDir = join(root, "software");
const outFile = join(outDir, "boulder-dash.d64");
const source =
  "https://archive.org/download/Boulder_Dash_1984_First_Star_cr_Nova/Boulder_Dash_1984_First_Star_cr_Nova.d64";

if (existsSync(outFile)) {
  console.log("[ensure-bd] already present", outFile);
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
const res = await fetch(source, { redirect: "follow" });
if (!res.ok) {
  console.error("[ensure-bd] download failed", res.status);
  process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());
if (buf.byteLength < 1000) {
  console.error("[ensure-bd] suspicious size", buf.byteLength);
  process.exit(1);
}
writeFileSync(outFile, buf);
console.log("[ensure-bd] wrote", outFile, buf.byteLength, "bytes");
