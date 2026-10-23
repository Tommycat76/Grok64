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

/** Optional: GROK64_WHEELS_URL=https://…/Wheels64.d64 (not redistributed in-repo). */
async function fetchWheelsOptional() {
  const url = process.env.GROK64_WHEELS_URL;
  if (!url) {
    console.log("skip Wheels (set GROK64_WHEELS_URL to download)");
    return;
  }
  const dest = join(dirs.geos, process.env.GROK64_WHEELS_NAME || "Wheels64.d64");
  await fetchTo(url, dest);
}

const CART_WANT = [
  { pattern: /Action_Replay_V6\.0_6\.0_1989_PAL/i, label: "ar6", out: "ar6.crt" },
  { pattern: /Action_Replay_V5\.0_5\.0_1988_PAL\.crt$/i, label: "ar5", out: "ar5.crt" },
  { pattern: /Action_Replay_MK4_1988_PAL/i, label: "ar4", out: "ar4.crt" },
  { pattern: /Final_Cartridge_3_1987-09_v1/i, label: "fc3", out: "fc3.crt" },
  { pattern: /Final_Cartridge_2_1987\.crt$/i, label: "fc2", out: "fc2.crt" },
  { pattern: /Final_Cartridge_1_v1_1986/i, label: "fc1", out: "fc1.crt" },
  { pattern: /Super_Snapshot_v4\.0_1989_NTSC/i, label: "ss4", out: "ss4.crt" },
  { pattern: /Super_Snapshot_v5\.00_1990_NTSC/i, label: "ss5", out: "ss5.crt" },
  { pattern: /Epyx_FastLoad_1984_v1/i, label: "epyx-fastload", out: "epyx-fastload.crt" },
  { pattern: /KCS_Power_Cartridge_1985_v1/i, label: "kcs-power", out: "kcs-power.crt" },
  { pattern: /WarpSpeed_v1_1987/i, label: "warp-speed", out: "warp-speed.crt" },
  { pattern: /macks-easyflash/i, label: "easyflash", out: "easyflash.crt" },
  { pattern: /superfluid-0\.8-rr_menu/i, label: "retro-replay", out: "retro-replay.crt" },
];

const PVD_P_NESTED = [
  { zip: "Simonbas.zip", crt: /simon.*\.crt$/i, out: "simons-basic.crt", source: "PvdP/Simonbas.zip" },
  { zip: "magic_desk.zip", crt: /magic_desk\.crt$/i, out: "magic-desk.crt", source: "PvdP/magic_desk.zip" },
  { zip: "Expert.zip", crt: /expert\.crt$/i, out: "expert.crt", source: "PvdP/Expert.zip" },
];

async function fetchPvdPNestedCarts() {
  const zipPath = join(dirs.carts, "PvdP-CRT-collection.zip");
  const id = "C64-CRT-Collection";
  await iaDownload(id, "PvdP-CRT-collection.zip", zipPath);
  const { unzipSync } = await import("fflate");
  const outer = unzipSync((await import("node:fs")).readFileSync(zipPath));
  for (const row of PVD_P_NESTED) {
    const blob = outer[row.zip];
    if (!blob) {
      console.warn("PvdP missing", row.zip);
      continue;
    }
    const inner = unzipSync(blob);
    const hit = Object.keys(inner).find((n) => row.crt.test(n.split("/").pop() ?? n));
    if (!hit) {
      console.warn("PvdP no crt in", row.zip);
      continue;
    }
    const dest = join(dirs.carts, row.out);
    writeFileSync(dest, inner[hit]);
    writeFileSync(dest.replace(/\.crt$/i, ".source.txt"), row.source + "/" + hit);
    console.log("ok", dest, "from", row.zip);
  }
}

/** Wrap Retro Replay 64K ROM (CSDb rr38ppal.bin) in a VICE CRT (ID 36). */
function packRetroReplayCrt(bin) {
  const name = "Retro Replay 3.8p PAL";
  const head = Buffer.alloc(64, 0);
  head.write("C64 CARTRIDGE", 0, "ascii");
  head.writeUInt32BE(64, 16);
  head.writeUInt16BE(0x40, 20);
  head.writeUInt16BE(1, 22);
  head.write(name, 32, "ascii");
  const chipName = Buffer.alloc(16, 0);
  chipName.write("CHIP", 0, "ascii");
  const chipHead = Buffer.alloc(16, 0);
  chipHead.writeUInt32BE(bin.length, 0);
  chipHead.writeUInt16BE(0, 4);
  chipHead.writeUInt16BE(0x8000, 6);
  return Buffer.concat([head, chipName, chipHead, Buffer.from(bin)]);
}

async function fetchRetroReplayRom() {
  const url = "http://csdb.dk/getinternalfile.php/14627/rr38ppal.zip";
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
  if (!res.ok) {
    console.warn("Retro Replay ROM zip", res.status);
    return;
  }
  const { unzipSync } = await import("fflate");
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  const binKey = Object.keys(files).find((n) => /\.bin$/i.test(n));
  if (!binKey) return;
  const crt = packRetroReplayCrt(files[binKey]);
  const dest = join(dirs.carts, "retro-replay-rom.crt");
  writeFileSync(dest, crt);
  writeFileSync(join(dirs.carts, "retro-replay-rom.source.txt"), "CSDb rr38ppal.bin");
  console.log("ok", dest, "from", url);
}

async function fetchWheelsDisk() {
  const urls = [
    process.env.GROK64_WHEELS_URL,
    "http://csdb.dk/getinternalfile.php/198632/Geos%20V1.2%20(1985)(BS).d64",
  ].filter(Boolean);
  for (const url of urls) {
    const dest = join(dirs.geos, process.env.GROK64_WHEELS_NAME || "Wheels64-ClickHere.d64");
    if (existsSync(dest) && dest.includes("Wheels")) return;
    const ok = await fetchTo(url, dest);
    if (ok && /wheels/i.test(dest)) return;
  }
  const searchUrls = [
    "https://raw.githubusercontent.com/alexeykhokhlov/geos-wheels/master/Wheels64.d64",
    "https://github.com/alexeykhokhlov/geos-wheels/raw/master/Wheels64.d64",
  ];
  for (const url of searchUrls) {
    const dest = join(dirs.geos, "Wheels64.d64");
    if (existsSync(dest)) return;
    const ok = await fetchTo(url, dest);
    if (ok) {
      console.log("ok wheels from", url);
      return;
    }
  }
  console.log("skip Wheels disk (set GROK64_WHEELS_URL or add fixtures/geos/Wheels64.d64)");
}

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
    const dest = join(dirs.carts, want.out ?? `${want.label}.crt`);
    writeFileSync(dest, files[hit]);
    writeFileSync(dest.replace(/\.crt$/i, ".source.txt"), hit);
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
await fetchWheelsOptional();
await fetchWheelsDisk();
await fetchCarts();
await fetchPvdPNestedCarts();
await fetchRetroReplayRom();
await fetchNuvieBadTom();
await fetchBoulderDisk();
console.log("done");
