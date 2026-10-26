#!/usr/bin/env node
/**
 * Hand gate for GEOS boot disks: real Google Chrome on a reused profile, driven only by
 * X11 input events (xdotool → XTEST) on its own Xvfb display, with an X11 screen grab at
 * every step and an X11 screen recording per run (scripts/desktop-hand-lib.mjs). The script
 * reads the page (screen text, core build, library bytes, About diagnostics) but never drives it.
 *
 * Per disk (GROK64_HAND_D64: the exact images under test) and JiffyDOS mode:
 *   the library row is compared with the image bytes; when it is missing or differs:
 *     Software → On this device → Remove, then Import through the native file dialog
 *   Settings → JiffyDOS switch, Power off → Power on (JiffyDOS on only counts with JiffyDOS live and
 *   its banner on screen, i.e. with the user's JiffyDOS ROMs in the profile; off needs the stock banner),
 *   Software → On this device → unit 8 → Insert (the screen has to stay at READY, nothing typed),
 *   click the CRT and type LOAD"$",8 / LIST, read the drive error channel with a short BASIC
 *   program (NEW, 10 OPEN1,8,15 ... 40 CLOSE1, RUN), then LOAD"GEOS",8,1 / RUN until the GEOS
 *   deskTop is on screen or the C64 resets, then About.
 * GROK64_HAND_EXPECT (one per disk, default desktop) is what desktop VICE x64sc does with the
 * same image and keys (scripts/vice-desktop-reference.mjs): "desktop"; "reset" for copy-protected
 * originals whose protection a D64 cannot hold (BOOTING GEOS ..., then the BASIC power-on
 * screen); "fnf" for an error-info D64 whose table marks the directory unreadable (FILE NOT FOUND
 * for $ and GEOS, a read error on track 18 in the error channel).
 *
 *   GROK64_HAND_D64=/a.d64,/b.d64 GROK64_HAND_EXPECT=reset,desktop node scripts/desktop-xdotool-geos-hand-boot.mjs
 *   GROK64_HAND_JIFFY=off,on   GROK64_HAND_DESKTOP_MS=240000   (display, Chrome and profile: desktop-hand-lib.mjs)
 * Default disk: the clean 1541 baseline (geosBaselineD64): GEOS_2.0.d64 (GROK64_GEOS_D64_PATH,
 * private-c64/geos or its copy in fixtures/geos) with its error-info table stripped, else
 * fixtures/geos/GEOS64_en.d64.
 * The image with its table is a separate check:
 *   GROK64_HAND_D64=private-c64/geos/GEOS_2.0.d64 GROK64_HAND_EXPECT=fnf
 * Output: screenshots/geos-hand-boot/<disk>/<jiffy-off|jiffy-on>/ and
 * artifacts/geos-hand-boot/results.json.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { waitBasicCommand, waitGeosBoot } from "./desktop-qa-lib.mjs";
import { geosBaselineD64, geosD64Fingerprint } from "./geos-fixture-lib.mjs";
import { d64Directory, d64ErrorInfoSummary } from "./d64-error-info-lib.mjs";
import {
  directoryMatchesImage,
  handConfig,
  openHand,
  screenTextAfterList,
  sleep,
  waitFor,
  withHandDisplay,
} from "./desktop-hand-lib.mjs";

const cwd = process.cwd();
const cfg = handConfig();
const modes = (process.env.GROK64_HAND_JIFFY || "off,on").split(",").map((s) => s.trim() === "on");
const deskTopMs = Number(process.env.GROK64_HAND_DESKTOP_MS || "240000");
const shotRoot = join(cwd, "screenshots", "geos-hand-boot");
const outDir = join(cwd, "artifacts", "geos-hand-boot");
const manifest = JSON.parse(
  readFileSync(join(cwd, "public/system/vice/emulatorjs/data/cores/grok64-core-manifest.json"), "utf8"),
);
mkdirSync(shotRoot, { recursive: true });
mkdirSync(outDir, { recursive: true });

function diskPaths() {
  const env = process.env.GROK64_HAND_D64;
  if (env) return env.split(",").map((s) => s.trim()).filter(Boolean).map((p) => resolve(p));
  return [geosBaselineD64(cwd).path];
}

function describeDisk(path) {
  const bytes = readFileSync(path);
  const fp = geosD64Fingerprint(bytes);
  const info = d64ErrorInfoSummary(bytes);
  return {
    path,
    name: basename(path),
    bytes: fp.bytes,
    sha1: fp.sha1,
    tomExact: fp.tomHand,
    bamName: fp.bamName,
    errorInfo: info.errorInfo
      ? { histogram: info.histogram, track18: info.track18, flaggedCount: info.badCount, flagged: info.bad.slice(0, 24) }
      : null,
    dir: d64Directory(bytes),
  };
}

const expects = (process.env.GROK64_HAND_EXPECT || "").split(",").map((s) => s.trim());
const disks = diskPaths()
  .filter((p) => existsSync(p))
  .map((p, i) => ({ ...describeDisk(p), expect: expects[i] || "desktop" }));
if (!disks.length) {
  console.log(JSON.stringify({ pass: false, skipped: true, reason: "no-disks" }));
  process.exit(0);
}

/** A listed disk leaves "0 OK"; an unreadable directory leaves a read error on track 18. */
function errorChannelExpected(ec, expect) {
  if (ec?.code == null) return false;
  if (expect === "fnf") return ec.code >= 20 && ec.code <= 29 && ec.track === 18;
  return ec.code === 0;
}

async function runAll() {
  const hand = await openHand(cfg, { shotDir: shotRoot });
  const { page, shot, key, type, typeLine, screenText, clickCrtAndType, closeSheet } = hand;
  const run = { ...hand.runInfo(), manifest: { buildId: manifest.buildId, glueSha12: manifest.glueSha12 }, disks: [] };

  const runMode = async (disk, jiffy) => {
    const mode = jiffy ? "jiffy-on" : "jiffy-off";
    const shotDir = join(shotRoot, disk.name.replace(/\.d64$/i, ""), mode);
    rmSync(shotDir, { recursive: true, force: true });
    mkdirSync(shotDir, { recursive: true });
    hand.setShotDir(shotDir);
    const trace = { disk: disk.name, mode, jiffy, steps: [] };
    hand.setTrace(trace);
    const stopRecording = cfg.record ? hand.startRecording(join(shotDir, `hand-boot-${mode}.mp4`)) : null;
    try {
      await hand.ensurePowered();
      trace.library = await hand.ensureInLibrary(disk, { shotPrefix: "00-import" });
      trace.jiffySwitch = await hand.setJiffy(jiffy, { shot: "01-settings-jiffy.png" });
      trace.power = await hand.powerCycle({ offShot: "02-power-off.png", onShot: "02-power-on-ready.png" });
      if (!trace.power.ready) throw new Error("no READY after Power on");
      trace.banner = (await screenText()).split("\n").filter((l) => l.trim()).slice(0, 3).join(" | ");
      trace.jiffyLive = await page.evaluate(() => window.__g64?.jiffyLive?.() ?? null);
      trace.jiffyBanner = /JIFFYDOS/i.test(trace.banner);
      trace.jiffyOk = jiffy ? trace.jiffyLive === true && trace.jiffyBanner : trace.jiffyLive !== true && !trace.jiffyBanner;
      trace.core = await hand.coreStatus();
      trace.coreOk = trace.core?.buildIdLoaded === manifest.buildId && trace.core?.buildMatches === true;
      trace.sessionFlags = await page.evaluate(() => window.__g64?.sessionFlags?.() ?? null);

      Object.assign(
        trace,
        await hand.insertFromLibrary(disk, { unit: 8, shot: "03-library-row.png", readyShot: "03-inserted-ready.png" }),
      );

      await clickCrtAndType('LOAD"$",8');
      trace.loadDollarLine = await hand.waitTypedLine('LOAD"$",8');
      trace.loadDollar = await waitBasicCommand(page, 'LOAD"$",8', 120_000);
      if (trace.loadDollar.error) {
        const d = await page.evaluate(() => window.__g64?.captureLoadDollarDiag?.(8) ?? null);
        trace.loadDollarDiag = d && { errorInfo: d.errorInfo, dos1541: d.dos1541, imgBamDiskName: d.imgBamDiskName };
      }
      await typeLine("LIST");
      await waitFor(async () => /BLOCKS FREE|FILE NOT FOUND|\?\w+ +ERROR/i.test(screenTextAfterList(await screenText())), 60_000, 1000);
      await sleep(1500);
      const listed = await screenText();
      trace.directory = directoryMatchesImage(listed, disk.dir);
      trace.directoryOk =
        disk.expect === "fnf"
          ? trace.loadDollarLine.found &&
            /FILE NOT FOUND/.test(trace.loadDollar.after ?? "") &&
            !/BLOCKS FREE/i.test(screenTextAfterList(listed))
          : trace.loadDollarLine.found && !trace.loadDollar.error && trace.directory.ok;
      trace.listScreen = listed.slice(0, 1200);
      await shot("04-directory.png");

      // The drive's own error channel, read the way a user would: a short BASIC program.
      trace.errorChannel = await hand.readErrorChannel(8);
      trace.errorChannelOk = errorChannelExpected(trace.errorChannel, disk.expect);
      await shot("04b-error-channel.png");

      await key("shift+Home");
      await sleep(600);
      await clickCrtAndType('LOAD"GEOS",8,1');
      trace.loadGeosLine = await hand.waitTypedLine('LOAD"GEOS",8,1');
      trace.firstKeyAfterClickOk = trace.loadGeosLine.found;
      await shot("05-load-geos-typed.png");
      let nextShot = 20_000;
      let bootingShot = false;
      const boot = await waitGeosBoot(page, {
        typeRun: async () => {
          await shot("06-load-geos-ready.png");
          await type("RUN");
          await key("Return");
          trace.steps.push({ typed: "RUN" });
        },
        deskTopMs,
        onTick: async (ms) => {
          if (!bootingShot && /BOOTING GEOS/i.test(await screenText())) {
            bootingShot = true;
            await shot("06-booting-geos.png");
          }
          if (ms < nextShot) return;
          await shot(`06-booting-${Math.round(nextShot / 1000)}s.png`);
          nextShot += 30_000;
        },
      });
      trace.loadGeos = boot.load;
      trace.run = boot.run;
      trace.bootingGeos = boot.bootingGeos;
      trace.deskTop = boot.deskTop && { pass: boot.deskTop.pass, reset: Boolean(boot.deskTop.reset), ms: boot.deskTop.ms };
      trace.outcome = boot.deskTop?.pass
        ? "desktop"
        : boot.deskTop?.reset
          ? "reset"
          : /FILE NOT FOUND/.test(boot.load?.after ?? "")
            ? "fnf"
            : "no-desktop";
      await sleep(2000);
      await shot(trace.outcome === "desktop" ? "07-desktop.png" : `07-${trace.outcome}.png`);
      await hand.openAbout({ shot: "08-about.png" });
      trace.pageErrors = hand.errors.splice(0).slice(0, 5);
      trace.expect = disk.expect;
      trace.pass = Boolean(
        trace.coreOk &&
          trace.jiffyOk &&
          trace.exactMedia &&
          trace.insertedExact &&
          trace.insertLeftReady &&
          trace.directoryOk &&
          trace.errorChannelOk &&
          trace.firstKeyAfterClickOk &&
          (disk.expect === "fnf" ? Boolean(trace.loadGeos?.error) : !trace.loadGeos?.error) &&
          trace.outcome === disk.expect,
      );
    } catch (e) {
      trace.error = String(e?.message || e);
      trace.pass = false;
      await hand.xgrab(join(shotDir, "99-error.png")).catch(() => {});
      await closeSheet().catch(() => {});
    } finally {
      if (stopRecording) await stopRecording().catch(() => {});
    }
    return trace;
  };

  try {
    Object.assign(run, await hand.start());
    for (const disk of disks) {
      const entry = { ...disk, modes: [] };
      run.disks.push(entry);
      for (const jiffy of modes) {
        const t = await runMode(disk, jiffy);
        entry.modes.push(t);
        console.log(
          JSON.stringify({
            disk: disk.name,
            mode: t.mode,
            pass: t.pass,
            coreOk: t.coreOk,
            exactMedia: t.exactMedia,
            insertToast: t.insertToast,
            insertedExact: t.insertedExact,
            imported: t.library?.imported,
            jiffyLive: t.jiffyLive,
            jiffyOk: t.jiffyOk,
            banner: t.banner,
            insertLeftReady: t.insertLeftReady,
            directoryOk: t.directoryOk,
            directory: t.directory,
            firstKeyAfterClickOk: t.firstKeyAfterClickOk,
            loadGeos: t.loadGeos && { error: t.loadGeos.error, ms: t.loadGeos.ms },
            bootingGeos: t.bootingGeos,
            outcome: t.outcome,
            expect: t.expect,
            deskTop: t.deskTop,
            dos1541: t.loadDollarDiag?.dos1541?.errorChannel,
            errorChannel: t.errorChannel?.text,
            error: t.error,
          }),
        );
      }
    }
  } catch (e) {
    run.error = String(e?.message || e);
    if (e?.info) Object.assign(run, e.info);
    console.log(JSON.stringify({ error: run.error }));
  } finally {
    await hand.close();
  }
  return run;
}

const run = await withHandDisplay(cfg, runAll);
const all = run.disks.flatMap((d) => d.modes);
run.pass = !run.error && all.length > 0 && all.every((m) => m.pass);
writeFileSync(join(outDir, "results.json"), JSON.stringify(run, null, 2));
writeFileSync(join(outDir, `results-run${run.profile?.runs ?? "x"}.json`), JSON.stringify(run, null, 2));
console.log(
  JSON.stringify({
    pass: run.pass,
    error: run.error,
    profile: run.profile,
    disks: run.disks.map((d) => ({
      name: d.name,
      sha1: d.sha1,
      tomExact: d.tomExact,
      expect: d.expect,
      modes: d.modes.map((m) => [m.mode, m.outcome, m.pass]),
    })),
  }),
);
process.exit(run.pass ? 0 : 1);
