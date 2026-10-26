#!/usr/bin/env node
/**
 * CI gate: shipped IEC core blob must match grok64-core-manifest.json + generated TS.
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const corePath = join(root, "public/system/vice/emulatorjs/data/cores/vice_x64sc-grok64-iec-wasm.data");
const manifestPath = join(root, "public/system/vice/emulatorjs/data/cores/grok64-core-manifest.json");
const genTsPath = join(root, "src/lib/emu/grok64-core-build.generated.ts");

const failures = [];
if (!existsSync(corePath)) failures.push("missing-blob");
if (!existsSync(manifestPath)) failures.push("missing-manifest");
if (!existsSync(genTsPath)) failures.push("missing-generated-ts");

if (!failures.length) {
  const bytes = readFileSync(corePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const genTs = readFileSync(genTsPath, "utf8");

  if (manifest.sha256 !== sha256) {
    failures.push(`manifest-sha-mismatch manifest=${manifest.sha256} blob=${sha256}`);
  }
  if (manifest.bytes !== bytes.byteLength) {
    failures.push(`manifest-bytes-mismatch manifest=${manifest.bytes} blob=${bytes.byteLength}`);
  }
  if (!genTs.includes(sha256)) {
    failures.push("generated-ts-maless-sha");
  }
  if (!genTs.includes(`"${manifest.buildId}"`)) {
    failures.push("generated-ts-buildId-mismatch");
  }
  if (manifest.glueSha12 && !genTs.includes(`"${manifest.glueSha12}"`)) {
    failures.push("generated-ts-glue-mismatch");
  }
}

if (failures.length) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        failures,
        hint: "Run: npm run grok64:core-manifest (after rebuilding vice_x64sc-grok64-iec-wasm.data)",
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, buildId: JSON.parse(readFileSync(manifestPath, "utf8")).buildId }));
