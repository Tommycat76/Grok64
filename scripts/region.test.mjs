import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});
const { detectSoftwareStandard, resolveSoftwareVideo, detectJoyPort } = await server.ssrLoadModule("/src/lib/emu/region.ts");
const { isWorkDiskImage, d64DiskName, bootFileName } = await server.ssrLoadModule("/src/lib/emu/formats.ts");
const { pickBootFile, isJunkRelease } = await server.ssrLoadModule("/src/lib/emu/archive.ts");
await server.close();

function sidWithFlags(videoBits) {
  const buf = new Uint8Array(0x90);
  buf.set([0x50, 0x53, 0x49, 0x44], 0);
  buf[4] = 0x00;
  buf[5] = 0x02;
  buf[6] = 0x00;
  buf[7] = 0x7c;
  buf[8] = 0x10;
  buf[9] = 0x00;
  buf[10] = 0x10;
  buf[11] = 0x00;
  buf[12] = 0x10;
  buf[13] = 0x03;
  buf[14] = 0x00;
  buf[15] = 0x01;
  buf[16] = 0x00;
  buf[17] = 0x01;
  const flags = videoBits << 2;
  buf[0x76] = (flags >> 8) & 0xff;
  buf[0x77] = flags & 0xff;
  buf[0x7c] = 0x60;
  return buf;
}

test("filename PAL/NTSC tags beat locale-less defaults", () => {
  assert.equal(detectSoftwareStandard("Last Ninja (PAL).d64"), "pal");
  assert.equal(detectSoftwareStandard("Summer Games (NTSC).d64"), "ntsc");
  assert.equal(detectSoftwareStandard("Boulder Dash [PAL].crt"), "pal");
  assert.equal(detectSoftwareStandard("Impossible Mission_ntsc.prg"), "ntsc");
});

test("TOSEC country tags", () => {
  assert.equal(detectSoftwareStandard("Wizball (Europe).d64"), "pal");
  assert.equal(detectSoftwareStandard("Wizball (UK).d64"), "pal");
  assert.equal(detectSoftwareStandard("Ghostbusters (USA).d64"), "ntsc");
  assert.equal(detectSoftwareStandard("Archon (Japan).d64"), "ntsc");
  assert.equal(detectSoftwareStandard("Elite (USA) (Europe).d64"), null);
});

test("explicit token wins over known-title map", () => {
  assert.equal(detectSoftwareStandard("M.U.L.E. (Europe).d64"), "pal");
  assert.equal(detectSoftwareStandard("Last Ninja (USA).d64"), "ntsc");
  assert.equal(detectSoftwareStandard("Boulder Dash (PAL).d64"), "pal");
});

test("known originals when the dump is untagged", () => {
  assert.equal(detectSoftwareStandard("M.U.L.E.d64"), "ntsc");
  assert.equal(detectSoftwareStandard("Archon.d64"), "ntsc");
  assert.equal(detectSoftwareStandard("The Last Ninja.d64"), "pal");
  assert.equal(detectSoftwareStandard("Turrican II.d64"), "pal");
  assert.equal(detectSoftwareStandard("Paradroid.d64"), "pal");
  assert.equal(detectSoftwareStandard("California Games.d64"), "ntsc");
  assert.equal(detectSoftwareStandard("Mayhem in Monsterland.d64"), "pal");
  assert.equal(detectSoftwareStandard("boulderdash-awally.d64"), "ntsc");
  assert.equal(detectSoftwareStandard("paradroidalldrives.d64"), "pal");
  assert.equal(detectSoftwareStandard("ghostbusters-c64.d64"), "ntsc");
});

test("SID header flags", () => {
  assert.equal(detectSoftwareStandard({ names: ["Commando.sid"], data: sidWithFlags(1) }), "pal");
  assert.equal(detectSoftwareStandard({ names: ["Tune.sid"], data: sidWithFlags(2) }), "ntsc");
  assert.equal(detectSoftwareStandard({ names: ["Both.sid"], data: sidWithFlags(3) }), null);
  assert.equal(detectSoftwareStandard({ names: ["Unknown.sid"], data: sidWithFlags(0) }), null);
});

test("SID flags lose to an explicit filename tag", () => {
  assert.equal(detectSoftwareStandard({ names: ["Hubbard (NTSC).sid"], data: sidWithFlags(1) }), "ntsc");
  assert.equal(detectSoftwareStandard({ names: ["Hubbard (PAL).sid"], data: sidWithFlags(2) }), "pal");
});

test("binary PAL/NTSC VERSION strings", () => {
  const pal = new TextEncoder().encode("LOADER PAL VERSION 1986");
  const ntsc = new TextEncoder().encode("NTSC ONLY RELEASE");
  assert.equal(detectSoftwareStandard({ names: ["crack.prg"], data: pal }), "pal");
  assert.equal(detectSoftwareStandard({ names: ["crack.prg"], data: ntsc }), "ntsc");
});

test("untagged unknown software stays unset (VICE PAL default at resolve)", () => {
  assert.equal(detectSoftwareStandard("WORK DISK.D64"), null);
  assert.equal(detectSoftwareStandard("random-crack.d64"), null);
  assert.equal(resolveSoftwareVideo("random-crack.d64"), "pal");
  assert.equal(resolveSoftwareVideo("M.U.L.E. (USA).d64"), "ntsc");
});

test("does not use locale-like names as a signal", () => {
  assert.equal(detectSoftwareStandard("en-US dump.d64"), null);
  assert.equal(detectSoftwareStandard("America_Denver.d64"), null);
});

test("work disk BAM name is detected so it cannot replace a game", async () => {
  const { readFileSync } = await import("node:fs");
  const blank = new Uint8Array(readFileSync("/workspace/public/software/blank.d64"));
  assert.equal(d64DiskName(blank), "WORK DISK");
  assert.equal(isWorkDiskImage(blank), true);
  const other = blank.slice();
  other[0x16500 + 0x90] = "B".charCodeAt(0);
  assert.equal(isWorkDiskImage(other), false);
});

test("boot filename keeps a C64 extension for VICE", () => {
  assert.equal(bootFileName("Boulder Dash.d64"), "Boulder Dash.d64");
  assert.equal(bootFileName("Paradroid"), "Paradroid.d64");
  assert.equal(bootFileName("tune.sid").toLowerCase().endsWith(".sid"), true);
});

test("pickBootFile skips docs and side B", () => {
  const files = [
    { name: "readme.txt" },
    { name: "Paradroid side B.d64" },
    { name: "Paradroid.d64" },
    { name: "preview.prg" },
  ];
  assert.equal(pickBootFile(files)?.name, "Paradroid.d64");
});

test("pickBootFile prefers original Boulder Dash over kit, trainer and A Wally", () => {
  const files = [
    { name: "Boulder Dash Construction Kit.d64" },
    { name: "Boulder Dash (1984)(First Star Software)[cr A Wally].d64" },
    { name: "Boulder Dash (1984)(First Star Software).d64" },
    { name: "preview.prg" },
    { name: "Boulder Dash +5 trainer.d64" },
  ];
  assert.equal(pickBootFile(files)?.name, "Boulder Dash (1984)(First Star Software).d64");
  assert.equal(isJunkRelease("Boulder Dash Construction Kit.d64"), true);
  assert.equal(isJunkRelease("Boulder Dash (1984)(First Star Software).d64"), false);
});

test("Boulder Dash family plugs into CIA port 1, everything else port 2", () => {
  assert.equal(detectJoyPort("Boulder Dash.d64"), 1);
  assert.equal(detectJoyPort({ names: ["Boulder_Dash_1984_First_Star_cr_Nova.d64", "Boulder Dash"] }), 1);
  assert.equal(detectJoyPort("Rockford.d64"), 1);
  assert.equal(detectJoyPort("Paradroid.d64"), 2);
  assert.equal(detectJoyPort("byte-hopper.prg"), 2);
  assert.equal(detectJoyPort("WORK DISK.D64"), 2);
});
