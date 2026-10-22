#!/usr/bin/env node
/**
 * Download freely redistributable test media into gitignored fixture dirs.
 *   node scripts/fetch-fixtures.mjs
 */
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import { Readable } from "node:stream";

const root = join(process.cwd(), "fixtures");
const dirs = {
  geos: join(root, "geos"),
  carts: join(root, "carts"),
  nuvie: join(root, "nuvie"),
  disks: join(root, "disks"),
};

for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });

async function fetchTo(url, dest, opts = {}) {
  if (existsSync(dest) && !opts.force) {
    console.log("skip", dest);
    return true;
  }
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
  if (!res.ok) {
    console.warn("fail", url, res.status);
    return false;
  }
  const body = res.body;
  if (!body) return false;
  await pipeline(Readable.fromWeb(body), createWriteStream(dest));
  console.log("ok", dest);
  return true;
}

async function iaDownload(identifier, fileName, dest) {
  const url = `https://archive.org/download/${identifier}/${encodeURIComponent(fileName)}`;
  return fetchTo(url, dest);
}

async function iaMetadata(identifier) {
  const res = await fetch(`https://archive.org/metadata/${identifier}`, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`metadata ${identifier} ${res.status}`);
  return res.json();
}

async function fetchGeos() {
  const id = "geos-64-2.0";
  const meta = await iaMetadata(id);
  const files = meta.files ?? [];
  const d64 = files.find((f) => /\.d64$/i.test(f.name) && /geos|deutsch|german|2\.0/i.test(f.name)) ??
    files.find((f) => /\.d64$/i.test(f.name));
  if (!d64) {
    console.warn("GEOS: no d64 in item");
    return;
  }
  await iaDownload(id, d64.name, join(dirs.geos, d64.name.replace(/\s+/g, "_")));
}

const CART_WANT = [
  { pattern: /Action_Replay_V6\.0/i, label: "ar6" },
  { pattern: /Final_Cartridge_3_1987-09_v1/i, label: "fc3" },
  { pattern: /Super_Snapshot_v4/i, label: "ss4" },
  { pattern: /Super_Snapshot_v5\.00_1990_NTSC/i, label: "ss5" },
];

async function fetchCarts() {
  const id = "C64-CRT-Collection";
  const zipName = "C64-CRT-collection.zip";
  const zipPath = join(dirs.carts, zipName);
  await iaDownload(id, zipName, zipPath);
  const { unzipSync } = await import("fflate");
  const { readFileSync: rfs } = await import("node:fs");
  const files = unzipSync(rfs(zipPath));
  const names = Object.keys(files).filter((n) => /\.crt$/i.test(n));
  for (const want of CART_WANT) {
    const hit = names.find((n) => want.pattern.test(n.split("/").pop() ?? n));
    if (!hit) {
      console.warn("cart missing", want.label, "in zip");
      continue;
    }
    const dest = join(dirs.carts, `${want.label}.crt`);
    writeFileSync(dest, files[hit]);
    writeFileSync(join(dirs.carts, `${want.label}.source.txt`), hit);
    console.log("ok", dest, "from", hit);
  }
}

async function fetchNuvieBadTom() {
  const zipUrl = "http://csdb.dk/getinternalfile.php/147044/bad%20tom.zip";
  const res = await fetch(zipUrl, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
  if (res.ok) {
    const { unzipSync } = await import("fflate");
    const zip = new Uint8Array(await res.arrayBuffer());
    const files = unzipSync(zip);
    const { writeFileSync: w } = await import("node:fs");
    const prgEntry = Object.entries(files).find(([n]) => /nuvieplayer.*\.prg$/i.test(n));
    if (prgEntry) {
      w(join(dirs.nuvie, "nuvieplayer1.0.prg"), prgEntry[1]);
      console.log("ok", join(dirs.nuvie, "nuvieplayer1.0.prg"), "from", prgEntry[0]);
    }
    const reuEntry = Object.entries(files).find(([n]) => /\.reu$/i.test(n));
    if (reuEntry) {
      w(join(dirs.nuvie, "badtom.reu"), reuEntry[1]);
      console.log("ok", join(dirs.nuvie, "badtom.reu"), "from", reuEntry[0]);
    }
  } else {
    console.warn("Bad Tom zip fetch failed", res.status);
  }
  const playerPath = join(dirs.nuvie, "nuvieplayer1.0.prg");
  if (!existsSync(playerPath)) {
    const player = "http://csdb.dk/getinternalfile.php/110242/nuvieplayer1.0.prg";
    await fetchTo(player, playerPath);
  }
}

async function fetchBoulderDisk() {
  const id = "Boulder_Dash_1984_First_Star_cr_Nova";
  await iaDownload(id, `${id}.d64`, join(dirs.disks, "boulder-dash.d64"));
}

console.log("Fetching fixtures →", root);
await fetchGeos();
await fetchCarts();
await fetchNuvieBadTom();
await fetchBoulderDisk();
console.log("done");
