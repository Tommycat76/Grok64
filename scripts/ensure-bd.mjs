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
let lastErr = "no attempt";
for (let i = 0; i < 3; i++) {
  try {
    const res = await fetch(source, { redirect: "follow" });
    if (!res.ok) {
      lastErr = `HTTP ${res.status}`;
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 1000) {
      lastErr = `suspicious size ${buf.byteLength}`;
      continue;
    }
    writeFileSync(outFile, buf);
    console.log("[ensure-bd] wrote", outFile, buf.byteLength, "bytes");
    process.exit(0);
  } catch (err) {
    lastErr = err instanceof Error ? err.message : String(err);
  }
}
console.warn("[ensure-bd] skipped (catalog cache):", lastErr);
process.exit(0);
