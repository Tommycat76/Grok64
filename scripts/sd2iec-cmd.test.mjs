import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { runSdCommand, resetSd2iecSession, addSdFile, formatPartition, listPartitions, mountedDiskImageName } =
  await server.ssrLoadModule("/src/lib/emu/sd2iec.ts");
const { prgToD64 } = await server.ssrLoadModule("/src/lib/emu/d64.ts");
await server.close();

test.beforeEach(() => {
  resetSd2iecSession();
});

test("CD<- and CD:_ return to parent directory", async () => {
  assert.equal(await runSdCommand('MD:"OS"'), "00, OK,00,00");
  assert.equal(await runSdCommand('CD:"OS"'), "00, OK,00,00");
  assert.match(await runSdCommand("CD<-"), /OK/);
  assert.match(await runSdCommand("X"), /PART 0/);
  assert.equal(await runSdCommand('CD:"OS"'), "00, OK,00,00");
  assert.match(await runSdCommand("CD:_"), /OK/);
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

test("RD removes a directory tree", async () => {
  await formatPartition(0);
  await addSdFile(0, "TMP.PRG", new Uint8Array([1, 8, 0, 0]).buffer, "scratch");
  assert.equal(await runSdCommand('MD:"SCRATCH"'), "00, OK,00,00");
  assert.equal(await runSdCommand('RD:"SCRATCH"'), "00, OK,00,00");
  const parts = await listPartitions();
  const f = parts[0].files.find((x) => x.path?.toUpperCase() === "SCRATCH");
  assert.equal(f, undefined);
});
