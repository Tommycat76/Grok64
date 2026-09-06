#!/usr/bin/env node
/**
 * TanStack Start SPA builds land in dist/client — flatten to dist/ for static hosts.
 */
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] || "dist";
const client = join(root, "client");

if (!existsSync(client)) {
  console.error(`[flatten-dist] missing ${client} — run vite build first`);
  process.exit(1);
}

for (const name of readdirSync(client)) {
  const from = join(client, name);
  const to = join(root, name);
  cpSync(from, to, { recursive: true, force: true });
}

rmSync(client, { recursive: true, force: true });
rmSync(join(root, "server"), { recursive: true, force: true });
console.log(`[flatten-dist] ready static root at ${root}/`);
