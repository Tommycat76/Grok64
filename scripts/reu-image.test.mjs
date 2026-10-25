import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const {
  isNuvieReuName,
  isReuImageName,
  parseC64uRunMeFirst,
  pickCompanionReu,
  resolveReuPlaySize,
  reuPairZipFiles,
  reuSizeFromByteLength,
  reuStem,
} = await server.ssrLoadModule("/src/lib/emu/reu-image.ts");
await server.close();

const blu = new Uint8Array(16 * 1024 * 1024);
const cfgText = `[C64 and Cartridge Settings]
RAM Expansion Unit=Enabled
REU Size=16 MB
REU Preload=Disabled
REU Preload Image=/Usb0/preload.reu
`;

test("C64U RunMeFirst.cfg yields 16 MB and ignores the USB preload path", () => {
  const cfg = parseC64uRunMeFirst(cfgText);
  assert.equal(cfg.reuEnabled, true);
  assert.equal(cfg.reuSizeKb, 16384);
  assert.equal(cfg.reuSize, "16384kB");
  assert.equal(cfg.preload, false);
  assert.equal(cfg.preloadImage, "preload.reu");
});

test("16 MB dump maps to VICE 16384kB", () => {
  assert.equal(reuSizeFromByteLength(16 * 1024 * 1024), "16384kB");
  assert.equal(resolveReuPlaySize({ bytes: blu.byteLength, cfg: parseC64uRunMeFirst(cfgText) }), "16384kB");
});

test("BluREU_Crest.prg pairs blu.reu by stem + cfg, not a Nuvie dump", () => {
  const nuvie = { name: "nuvie-play.reu", data: new Uint8Array(1024) };
  const dump = { name: "blu.reu", data: blu };
  const cfg = { name: "RunMeFirst.cfg", data: new TextEncoder().encode(cfgText) };
  const pick = pickCompanionReu({
    bootName: "BluREU_Crest.prg",
    library: [nuvie, dump, cfg],
  });
  assert.ok(pick);
  assert.equal(pick.candidate.name, "blu.reu");
  assert.notEqual(pick.reason, "nuvie");
  assert.equal(isNuvieReuName("blu.reu"), false);
  assert.equal(isNuvieReuName("demo.nuv"), true);
});

test("BlueMax.prg does not steal a 3-letter blu.reu without a cfg", () => {
  const pick = pickCompanionReu({
    bootName: "BlueMax.prg",
    library: [{ name: "blu.reu", data: blu }],
  });
  assert.equal(pick, null);
});

test("same-basename companion wins", () => {
  const pick = pickCompanionReu({
    bootName: "demo.prg",
    parts: [
      { name: "other.reu", data: new Uint8Array(512 * 1024) },
      { name: "demo.reu", data: new Uint8Array(2048 * 1024) },
    ],
  });
  assert.equal(pick?.candidate.name, "demo.reu");
  assert.equal(pick?.reason, "same-basename");
});

test("pair zip uses the program basename so libretro -reuimage matches", () => {
  const z = reuPairZipFiles("BluREU_Crest.prg", new Uint8Array([1, 2, 3]), blu);
  assert.equal(z.zipName, "BluREU_Crest.zip");
  assert.equal(z.prgName, "BluREU_Crest.prg");
  assert.equal(z.reuName, "BluREU_Crest.reu");
  assert.ok(z.files["BluREU_Crest.prg"]);
  assert.equal(z.files["BluREU_Crest.reu"].byteLength, blu.byteLength);
});

test("Nuvie names stay on the Nuvie path", () => {
  assert.equal(isReuImageName("scene.nuv"), true);
  assert.equal(isNuvieReuName("My Nuvie dump.reu"), true);
  assert.equal(isNuvieReuName("blu.reu"), false);
  assert.equal(reuStem("BluREU_Crest.prg"), "blureucrest");
});
