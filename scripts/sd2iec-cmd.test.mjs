import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const {
  runSdCommand,
  resetSd2iecSession,
  addSdFile,
  formatPartition,
  listPartitions,
  mountedDiskImageName,
  grok64WasmIecHost: host,
  resetGrok64WasmIecBus,
} = await server.ssrLoadModule("/src/lib/emu/sd2iec.ts");
const { prgToD64 } = await server.ssrLoadModule("/src/lib/emu/d64.ts");
// sd2iec.ts imports its card source lazily, so the module runner has to outlive the tests.
test.after(() => server.close());

test.beforeEach(() => {
  resetSd2iecSession();
  resetGrok64WasmIecBus();
});

/** LISTEN + OPEN on `sec`, the name, UNLISTEN: what the KERNAL sends before LOAD reads a file. */
function openOnBus(dev, sec, name) {
  host.iecOpen(dev, 0xf0 | sec);
  for (const c of name) host.iecWrite(dev, 0xf0 | sec, c.charCodeAt(0));
  host.iecUnlisten(dev, 0xf0 | sec);
}

/** Bytes the bus device would send: up to the one that carries EOF ($40), or none on an error. */
function readChannel(dev, sec) {
  const bytes = [];
  for (let i = 0; i < 70_000; i++) {
    const b = host.iecRead(dev, sec);
    const st = host.iecReadSt;
    if (st & 0x02) return { bytes, st };
    bytes.push(b);
    if (st & 0x40) return { bytes, st };
  }
  return { bytes, st: null };
}

/** LIST of a loaded directory: line number, a space, then the line's bytes. */
function listed(bytes) {
  const lines = [];
  let i = 2;
  while (i + 4 <= bytes.length && (bytes[i] | bytes[i + 1])) {
    let j = i + 4;
    let text = "";
    while (j < bytes.length && bytes[j] !== 0) text += String.fromCharCode(bytes[j++]);
    lines.push(`${bytes[i + 2] | (bytes[i + 3] << 8)} ${text}`);
    i = j + 1;
  }
  return lines;
}

test("$ on the IEC bus is a CBM listing: header, folders, files, BLOCKS FREE.", async () => {
  await formatPartition(0);
  await addSdFile(0, "hello.prg", new Uint8Array([1, 8, 0, 0]).buffer, "");
  await addSdFile(0, "inside.prg", new Uint8Array(600).buffer, "games");
  openOnBus(10, 0, "$");
  const dir = readChannel(10, 0);
  assert.equal(dir.st, 0x40);
  assert.deepEqual(dir.bytes.slice(0, 2), [0x01, 0x04]);
  assert.deepEqual(listed(dir.bytes), [
    '0 \x12"GROK64 SD       " SD 2A',
    `0    "GAMES"${" ".repeat(12)}DIR `,
    `1    "HELLO"${" ".repeat(12)}PRG `,
    "65535 BLOCKS FREE.",
  ]);

  assert.match(await runSdCommand("CD:GAMES"), /OK/);
  openOnBus(10, 0, "$");
  assert.deepEqual(listed(readChannel(10, 0).bytes).slice(1, 3), [
    `0    "\x5f"${" ".repeat(16)}DIR `,
    `3    "INSIDE"${" ".repeat(11)}PRG `,
  ]);
});

test("a file is sent as stored, EOF with its last byte; a missing file sends nothing", async () => {
  await formatPartition(0);
  await addSdFile(0, "hello.prg", new Uint8Array([1, 8, 0xaa, 0xbb]).buffer, "");
  openOnBus(10, 0, "HELLO");
  assert.deepEqual(readChannel(10, 0), { bytes: [1, 8, 0xaa, 0xbb], st: 0x40 });
  openOnBus(10, 0, "NOSUCH");
  assert.deepEqual(readChannel(10, 0), { bytes: [], st: 0x42 });
});

test("CD:NAME.D64 lists the image's own directory and loads its files as stored", async () => {
  const prg = [1, 8, 0x0b, 0x08, 0x0a, 0x00, 0x99, 0x22, 0x48, 0x49, 0x22, 0x00, 0x00, 0x00];
  await formatPartition(0);
  await addSdFile(0, "WRAP.D64", prgToD64(new Uint8Array(prg), "INNER").buffer, "");
  assert.match(await runSdCommand("CD:WRAP.D64"), /OK/);
  openOnBus(10, 0, "$");
  assert.deepEqual(listed(readChannel(10, 0).bytes), [
    '0 \x12"INNER           " G6 2A',
    `1    "INNER"${" ".repeat(12)}PRG `,
    "663 BLOCKS FREE.",
  ]);
  openOnBus(10, 0, "INNER");
  assert.deepEqual(readChannel(10, 0), { bytes: prg, st: 0x40 });
  openOnBus(10, 0, "IN*");
  assert.deepEqual(readChannel(10, 0).bytes, prg);
  openOnBus(10, 0, "HELLO");
  assert.equal(readChannel(10, 0).st, 0x42);
  assert.match(await runSdCommand("CD\x5f"), /OK/);
  assert.equal(mountedDiskImageName(), null);
});

test("CD<- and CD:_ return to parent directory", async () => {
  assert.equal(await runSdCommand('MD:"OS"'), "00, OK,00,00");
  assert.equal(await runSdCommand('CD:"OS"'), "00, OK,00,00");
  assert.match(await runSdCommand("CD<-"), /OK/);
  assert.match(await runSdCommand("X"), /PART 0/);
  assert.equal(await runSdCommand('CD:"OS"'), "00, OK,00,00");
  assert.match(await runSdCommand("CD:_"), /OK/);
});

test("1//:c64os partition path (sd2iec 1-based)", async () => {
  await formatPartition(0);
  await addSdFile(0, "BOOT.PRG", new Uint8Array([1, 8, 0, 0]).buffer, "c64os");
  assert.match(await runSdCommand('CD:"1//:c64os"'), /OK/);
  assert.match(await runSdCommand("X"), /c64os/i);
});

test("CP switches partition", async () => {
  assert.equal(await runSdCommand("CP1"), "00, OK,00,00");
  assert.match(await runSdCommand("X"), /PART 1/);
  assert.equal(await runSdCommand("CP0"), "00, OK,00,00");
});

test("CD into a D64 on the card lists PRGs from the image", async () => {
  const disk = prgToD64(new Uint8Array([1, 8, 0, 10, 0x11, 0x22]), "INNER");
  await formatPartition(0);
  await addSdFile(0, "WRAP.D64", disk.buffer, "");
  assert.match(await runSdCommand('CD:"WRAP.D64"'), /OK/);
  assert.equal(mountedDiskImageName(), "WRAP.D64");
  resetSd2iecSession();
});

test("CD// keeps mounted D64; CD← at image root unmounts (C64 OS SD2IEC manual)", async () => {
  const disk = prgToD64(new Uint8Array([1, 8, 0, 10, 0x11, 0x22]), "INNER");
  await formatPartition(0);
  await addSdFile(0, "WRAP.D64", disk.buffer, "");
  assert.match(await runSdCommand('CD:"WRAP.D64"'), /OK/);
  assert.match(await runSdCommand("CD//"), /OK/);
  assert.equal(mountedDiskImageName(), "WRAP.D64");
  assert.match(await runSdCommand("CD←"), /OK/);
  assert.equal(mountedDiskImageName(), null);
});

test("CD← accepts PETSCII-style back alias CD<-", async () => {
  const disk = prgToD64(new Uint8Array([1, 8, 0, 10, 0x11, 0x22]), "INNER");
  await formatPartition(0);
  await addSdFile(0, "WRAP.D64", disk.buffer, "");
  await runSdCommand('CD:"WRAP.D64"');
  assert.match(await runSdCommand("CD<-"), /OK/);
  assert.equal(mountedDiskImageName(), null);
});

test("RD removes a directory tree", async () => {
  await formatPartition(0);
  await addSdFile(0, "TMP.PRG", new Uint8Array([1, 8, 0, 0]).buffer, "scratch");
  assert.equal(await runSdCommand('MD:"SCRATCH"'), "00, OK,00,00");
  assert.equal(await runSdCommand('RD:"SCRATCH"'), "00, OK,00,00");
  const parts = await listPartitions();
  const f = parts[0].files.find((x) => x.path?.toUpperCase() === "SCRATCH");
  assert.equal(f, undefined);
});
