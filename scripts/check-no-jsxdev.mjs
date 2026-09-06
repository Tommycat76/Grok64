#!/usr/bin/env node
/**
 * Fail the build if production chunks still reference jsxDEV.
 * A mixed dev/prod JSX runtime blanks the app on static hosts.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] || "dist";
const hits = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      walk(path);
      continue;
    }
    if (!/\.(js|mjs|cjs)$/.test(name)) continue;
    const text = readFileSync(path, "utf8");
    if (text.includes("jsxDEV")) hits.push(path);
  }
}

try {
  walk(root);
} catch (err) {
  console.error(`[check:jsx] could not scan ${root}:`, err);
  process.exit(1);
}

if (hits.length) {
  console.error("[check:jsx] jsxDEV found in production output:");
  for (const file of hits) console.error(`  - ${file}`);
  process.exit(1);
}

console.log(`[check:jsx] OK — no jsxDEV in ${root}`);
