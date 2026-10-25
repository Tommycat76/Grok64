#!/usr/bin/env node
/**
 * Error-info stand-ins for a GEOS 2.0 boot disk: a clean 174848-byte D64 with a 683-byte error-info
 * table appended (one code per sector from track 1 sector 0; 01 = OK, 04 = data block not found,
 * 05 = data checksum error), for checking what stock VICE and Grok64 do with such a table when the
 * original image is not at hand.
 *   tom-density  the figures Tom read from his GEOS_2.0.d64: 347 x 05, 335 x 01 and one 04, track 18
 *                starting 01 05 01 05 05 01 05 (sectors 1, 3, 4 and 6 bad). Past those seven codes
 *                the table is a fixed fill that only keeps his totals.
 *   tom-t18      those seven track-18 codes alone, every other sector 01
 *   t18s1-05     track 18 sector 1 (the first directory block) 05, every other sector 01
 *   all01        every sector 01
 *
 *   node scripts/make-d64-error-table-standins.mjs [clean.d64] [outDir]
 * Defaults: fixtures/geos/GEOS64_en.d64 → fixtures/geos/recon/GEOS64_en+table-<name>.d64
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { D64_SPT, d64ErrorInfoSummary, d64SectorIndex } from "./d64-error-info-lib.mjs";

/** One row per track, one hex digit per sector. */
const TOM_DENSITY_ROWS = [
  "111551111511111515511", "555151511511155155151", "155155555551151515515", "551154515551155555151",
  "111551551551115151155", "551111151111111155111", "151155515155515155155", "515551155155111151111",
  "151511511111111515511", "551515511155555515111", "511551155111155555511", "511151115551551515155",
  "515111115151155515155", "111555151111515511511", "155551151511115515115", "155511555111511151155",
  "151111515111555555155", "1515515155155115551", "5511515551551115511", "5551115151111555555",
  "1155111511115115555", "5555555151155515555", "1111151111111515151", "5551555511115515115",
  "515151555551511155", "151151115515155555", "511111515551151151", "111155151151151551",
  "515151151511555551", "515115511511551111", "55515555115555515", "55511551555551551",
  "55515115515155151", "15151551551551111", "51151555555155155",
];
const TOM_TRACK18_PREFIX = [1, 5, 1, 5, 5, 1, 5];
const SECTORS = D64_SPT.slice(0, 35).reduce((a, b) => a + b, 0);
const CLEAN_BYTES = 174848;

function table(fill) {
  const t = new Uint8Array(SECTORS).fill(1);
  fill(t);
  return t;
}

const STANDINS = {
  "tom-density": table((t) => {
    let i = 0;
    TOM_DENSITY_ROWS.forEach((row, track) => {
      if (row.length !== D64_SPT[track]) throw new Error(`track ${track + 1}: ${row.length} codes`);
      for (const c of row) t[i++] = parseInt(c, 16);
    });
  }),
  "tom-t18": table((t) => TOM_TRACK18_PREFIX.forEach((c, s) => (t[d64SectorIndex(18, s)] = c))),
  "t18s1-05": table((t) => (t[d64SectorIndex(18, 1)] = 5)),
  all01: table(() => {}),
};

const cwd = process.cwd();
const src = resolve(process.argv[2] || join(cwd, "fixtures", "geos", "GEOS64_en.d64"));
const outDir = resolve(process.argv[3] || join(cwd, "fixtures", "geos", "recon"));
const clean = readFileSync(src);
if (clean.length !== CLEAN_BYTES) {
  console.error(`${src}: ${clean.length} bytes, need a 35-track D64 without a table (${CLEAN_BYTES})`);
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const stem = basename(src).replace(/\.d64$/i, "");
for (const [name, codes] of Object.entries(STANDINS)) {
  const path = join(outDir, `${stem}+table-${name}.d64`);
  const image = Buffer.concat([clean, codes]);
  writeFileSync(path, image);
  const s = d64ErrorInfoSummary(image);
  console.log(JSON.stringify({ path, histogram: s.histogram, track18: s.track18 }));
}
