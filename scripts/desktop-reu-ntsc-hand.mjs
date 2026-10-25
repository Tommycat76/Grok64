#!/usr/bin/env node
/**
 * Hand gate for REU image preload (BluREU) and cart filename NTSC/PAL tags.
 * Real Chrome on the reused profile; Software → Import through the native file
 * dialog; Play / Insert clicked on the library row. Reads the C64 screen and
 * core status; never types LOAD"*" / LOAD"$".
 *
 *   GROK64_HAND_RECORD=0 node scripts/desktop-reu-ntsc-hand.mjs
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { handConfig, openHand, sleep, waitFor, withHandDisplay } from "./desktop-hand-lib.mjs";

const cwd = process.cwd();
const cfg = handConfig();
const mediaRoot = resolve(process.env.GROK64_FIX_MEDIA || join(cwd, ".media"));
const bluDir = join(mediaRoot, "DEMOS", "BluREU");
const files = {
  prg: join(bluDir, "BluREU_Crest.prg"),
  reu: join(bluDir, "blu.reu"),
  cfg: join(bluDir, "RunMeFirst.cfg"),
  ntsc: join(mediaRoot, "GUI64 [NTSC].crt"),
  pal: join(mediaRoot, "GUI64 [PAL].crt"),
};
const shotRoot = join(cwd, "screenshots", "reu-ntsc-hand");
const outDir = join(cwd, "artifacts", "reu-ntsc-hand");
mkdirSync(shotRoot, { recursive: true });
mkdirSync(outDir, { recursive: true });

function sha1Of(path) {
  return createHash("sha1").update(readFileSync(path)).digest("hex");
}
function media(path) {
  return { path, name: basename(path), sha1: sha1Of(path), bytes: readFileSync(path).byteLength };
}

function failMissing() {
  const missing = Object.entries(files).filter(([, p]) => !existsSync(p)).map(([k, p]) => ({ k, p }));
  if (!missing.length) return null;
  console.log(JSON.stringify({ pass: false, skipped: true, reason: "fix media missing", missing }, null, 2));
  return missing;
}

async function importOnly(hand, file, prefix) {
  const rows = (await hand.libraryRows()).filter((r) => r.name === file.name);
  const good = rows.filter((r) => r.sha1 === file.sha1);
  if (rows.length === 1 && good.length === 1) return { imported: false };
  await hand.openLibrary();
  for (let i = 0; i < rows.length; i++) {
    const btn = hand.page.getByRole("button", { name: `Remove ${file.name}`, exact: true }).first();
    if (await btn.isVisible().catch(() => false)) {
      await hand.click(btn, `Remove ${file.name}`);
      await sleep(500);
    }
  }
  await hand.click(hand.page.locator(".g64-actions button").filter({ hasText: /^Import$/ }).first(), "Import");
  await hand.chooseFileInDialog(file.path, { shotPrefix: `${prefix}-dialog` });
  const row = await waitFor(
    async () => (await hand.libraryRows()).find((r) => r.name === file.name && r.sha1 === file.sha1),
    45_000,
    400,
  );
  if (!row) throw new Error(`import did not store ${file.name}`);
  await hand.closeSheet();
  await sleep(400);
  return { imported: true, rowSha1: row.sha1 };
}

async function playFromLibrary(hand, file, prefix) {
  await hand.openLibrary();
  const card = hand.page.locator(".g64-card").filter({ has: hand.page.getByText(file.name, { exact: true }) }).first();
  await card.waitFor({ state: "attached", timeout: 30_000 });
  const play = hand.page.getByRole("button", { name: new RegExp(`^(Play|Run) ${file.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) });
  await play.waitFor({ state: "attached", timeout: 20_000 });
  await hand.reveal(play, `Play ${file.name}`);
  await hand.shot(`${prefix}-row.png`);
  await hand.click(play, `Play ${file.name}`);
  await waitFor(async () => !(await hand.sheetOpen()), 15_000);
}

async function insertFromLibraryReu(hand, file, prefix) {
  await hand.ensurePowered();
  await hand.openLibrary();
  const insert = hand.page.getByRole("button", { name: `Insert ${file.name}`, exact: true });
  await insert.waitFor({ state: "attached", timeout: 20_000 });
  await hand.reveal(insert, `Insert ${file.name}`);
  await hand.shot(`${prefix}-insert-row.png`);
  await hand.click(insert, `Insert ${file.name}`);
  await waitFor(async () => !(await hand.sheetOpen()), 15_000);
}

const FAILED = /REU FOUND BUT DATA CHECK FAILED|DATA CHECK FAILED/i;
const CREST = /CREST|BLUREU|BLU REU|NEVER GONNA/i;

async function main() {
  if (failMissing()) process.exit(0);
  const prg = media(files.prg);
  const reu = media(files.reu);
  const cfg = media(files.cfg);
  const ntsc = media(files.ntsc);
  const pal = media(files.pal);
  const run = {
    media: { prg: prg.name, reuBytes: reu.bytes, ntsc: ntsc.name, pal: pal.name },
    blu: {},
    ntscCart: {},
    palCart: {},
  };

  await withHandDisplay(cfg, async () => {
    const hand = await openHand(cfg, { shotDir: join(shotRoot, "boot") });
    let stopRec = async () => {};
    try {
      run.start = await hand.start();
      run.core = await hand.coreStatus();
      await hand.shot("00-home.png");

      hand.setShotDir(join(shotRoot, "blureu"));
      mkdirSync(hand.shotDir(), { recursive: true });
      if (cfg.record) stopRec = await hand.startRecording(join(outDir, "blureu.mp4"));

      await importOnly(hand, cfg, "cfg");
      await importOnly(hand, reu, "reu");
      await importOnly(hand, prg, "prg");
      run.blu.library = (await hand.libraryRows()).filter((r) =>
        [prg.name, reu.name, cfg.name].includes(r.name),
      );
      await playFromLibrary(hand, prg, "blu-play");
      const running = await waitFor(
        async () => (await hand.page.evaluate(() => window.__g64?.running?.() && !window.__g64?.booting?.())) || null,
        180_000,
        500,
      );
      run.blu.started = Boolean(running);
      const screen = await waitFor(
        async () => {
          const t = await hand.screenText();
          if (FAILED.test(t) || CREST.test(t)) return t;
          return null;
        },
        90_000,
        800,
      );
      const later = screen || (await hand.screenText());
      run.blu.screen = later.split("\n").filter((l) => l.trim()).slice(0, 24);
      run.blu.failedCheck = FAILED.test(later);
      run.blu.demoText = CREST.test(later);
      run.blu.reu = await hand.page.evaluate(() => ({
        size: window.__g64?.reu?.(),
        kb: window.__g64?.reuKb?.(),
        armed: window.__g64?.armedReu?.(),
      }));
      await sleep(2000);
      await hand.shot("blu-after-play.png");
      await stopRec();
      stopRec = async () => {};

      hand.setShotDir(join(shotRoot, "ntsc-cart"));
      mkdirSync(hand.shotDir(), { recursive: true });
      await importOnly(hand, ntsc, "ntsc");
      await playFromLibrary(hand, ntsc, "ntsc-play");
      await waitFor(
        async () => (await hand.page.evaluate(() => window.__g64?.running?.() && !window.__g64?.booting?.())) || null,
        180_000,
        500,
      );
      await sleep(4000);
      run.ntscCart.video = await hand.page.evaluate(() => window.__g64?.video?.());
      run.ntscCart.screen = (await hand.screenText()).split("\n").filter((l) => l.trim()).slice(0, 16);
      await hand.shot("ntsc-after-play.png");

      hand.setShotDir(join(shotRoot, "pal-cart"));
      mkdirSync(hand.shotDir(), { recursive: true });
      await importOnly(hand, pal, "pal");
      await playFromLibrary(hand, pal, "pal-play");
      await waitFor(
        async () => (await hand.page.evaluate(() => window.__g64?.running?.() && !window.__g64?.booting?.())) || null,
        180_000,
        500,
      );
      await sleep(4000);
      run.palCart.video = await hand.page.evaluate(() => window.__g64?.video?.());
      run.palCart.screen = (await hand.screenText()).split("\n").filter((l) => l.trim()).slice(0, 16);
      await hand.shot("pal-after-play.png");

      run.coreAfter = await hand.coreStatus();
      run.errors = hand.errors.slice(0, 12);
    } finally {
      await stopRec();
      await hand.close();
    }
  });

  run.blu.pass = Boolean(run.blu.started && !run.blu.failedCheck && run.blu.reu?.size === "16384kB");
  run.ntscCart.pass = run.ntscCart.video?.resolved === "ntsc" || run.ntscCart.video?.software === "ntsc";
  run.palCart.pass = run.palCart.video?.resolved === "pal" || run.palCart.video?.software === "pal";
  run.pass = Boolean(run.blu.pass && run.ntscCart.pass && run.palCart.pass);
  writeFileSync(join(outDir, "results.json"), JSON.stringify(run, null, 2));
  console.log(JSON.stringify(run, null, 2));
  process.exit(run.pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
