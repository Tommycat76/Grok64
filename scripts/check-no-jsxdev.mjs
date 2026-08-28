import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const ROOTS = ["dist", ".output"];
const BAD = /jsxDEV/;
const hits = [];

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }
    if (!/\.(js|mjs|cjs|map)$/.test(entry.name)) continue;
    const info = await stat(path);
    if (info.size > 8 * 1024 * 1024) continue;
    const text = await readFile(path, "utf8");
    if (BAD.test(text)) hits.push(path);
  }
}

for (const root of ROOTS) await walk(root);

if (hits.length) {
  console.error("jsxDEV found in production output:");
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(1);
}

console.log("OK: no jsxDEV in production output");
