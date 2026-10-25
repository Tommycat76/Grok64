#!/usr/bin/env node
/**
 * Desktop VICE reference run for D64 images: stock x64sc (GTK) on its own Xvfb display, true drive
 * emulation on drive 8 (1541), VICE defaults otherwise (-default, fresh config dir, sound off).
 * Every command is typed as X11 key events into the VICE window (xdotool → XTEST), as a user
 * would type it; the C64 screen is read back with the "screen" command of VICE's text remote
 * monitor, and each step saves a VICE screenshot plus an X11 grab of the whole desktop.
 *
 * Steps per image: power on → LOAD"$",8 → LIST → the drive error channel, read by a four-line
 * BASIC program (no colons: a shifted ":" can race VICE's keyboard scan and arrive as "[") →
 * LOAD"GEOS",8,1 → RUN when it returns READY. (GEOS 2.0 usually starts itself), then up to
 * VICE_REF_DESKTOP_MS for the GEOS deskTop. A D64 with an error-info table is also run as its
 * first 174848 (35 tracks) or 196608 (40 tracks) bytes, i.e. with the table stripped, unless
 * VICE_REF_STRIPPED=0. Byte-identical images are run once.
 *
 *   node scripts/vice-desktop-reference.mjs /path/GEOS_2.0.d64 [more.d64 ...]
 *   VICE_BIN=/usr/bin/x64sc   VICE_DATA=<XDG data dir with vice/C64 + vice/DRIVES ROMs>
 *   VICE_XDISPLAY=:96   VICE_REF_GEOS=0 (no GEOS boot)   VICE_REF_KEY_HOLD_MS=80   VICE_REF_KEY_GAP_MS=80
 *   VICE_REF_TDE=0: diagnostic only, VICE's virtual drive instead of the emulated 1541
 *   VICE_REF_TAG=rerun2: appended to the output names, so a rerun keeps the earlier report
 * A load that never comes back also records the 1541's registers, job queue and head track.
 * Keys go down and up as separate events with a hold: "xdotool type" and a bare "xdotool key"
 * release faster than the C64 scans its keyboard (60 Hz), and VICE then drops them.
 * Output: screenshots/vice-reference/<vice-version>[-tde-off][-tag]/<image>/ and
 * artifacts/vice-reference/<vice-version>[-tde-off][-tag].json
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { d64Directory, d64ErrorInfoSummary, d64Layout } from "./d64-error-info-lib.mjs";

const cwd = process.cwd();
const viceBin = process.env.VICE_BIN || "x64sc";
const viceData = process.env.VICE_DATA ? resolve(process.env.VICE_DATA) : null;
const display = process.env.VICE_XDISPLAY || ":96";
const wm = process.env.VICE_REF_WM ?? "xfwm4";
const keyHoldMs = Number(process.env.VICE_REF_KEY_HOLD_MS || "80");
const keyGapMs = Number(process.env.VICE_REF_KEY_GAP_MS || "80");
const KEYSYM = {
  '"': "quotedbl", $: "dollar", ",": "comma", ":": "colon", ";": "semicolon", "#": "numbersign", " ": "space",
  "*": "asterisk", ".": "period", "=": "equal", "+": "plus", "-": "minus", "/": "slash", "@": "at",
};
const runGeos = process.env.VICE_REF_GEOS !== "0";
const runStripped = process.env.VICE_REF_STRIPPED !== "0";
const tde = process.env.VICE_REF_TDE !== "0";
const deskTopMs = Number(process.env.VICE_REF_DESKTOP_MS || "180000");
const monPort = Number(process.env.VICE_REF_MONITOR_PORT || "6599");
const SCREEN = { w: 1280, h: 900 };
const DRIVE_RESOURCES = [
  "Drive8Type",
  "Drive8TrueEmulation",
  "VirtualDevice8",
  "IECDevice8",
  "Drive8IdleMethod",
  "Drive8ExtendImagePolicy",
  "DriveSoundEmulation",
  "AutostartHandleTrueDriveEmulation",
  "MachineVideoStandard",
  "DosName1541",
  "KernalName",
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const progress = (msg) => console.error(`[vice-ref] ${msg}`);

const images = process.argv.slice(2).map((p) => resolve(p));
if (!images.length) {
  console.error("usage: node scripts/vice-desktop-reference.mjs <image.d64> [more.d64 ...]");
  process.exit(2);
}

const versionText = execFileSync(viceBin, ["--version"], { encoding: "utf8" }).trim();
const viceVersion = /VICE\s+([\d.]+)/.exec(versionText)?.[1] ?? "unknown";
const tag = process.env.VICE_REF_TAG ? `-${process.env.VICE_REF_TAG}` : "";
const slug = `vice-${viceVersion}${tde ? "" : "-tde-off"}${tag}`;
const shotRoot = join(cwd, "screenshots", "vice-reference", slug);
const outDir = join(cwd, "artifacts", "vice-reference");
mkdirSync(shotRoot, { recursive: true });
mkdirSync(outDir, { recursive: true });

function sh(cmd, args, { allowFail = false, timeoutMs = 0 } = {}) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { env: { ...process.env, DISPLAY: display }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const timer = timeoutMs ? setTimeout(() => p.kill("SIGKILL"), timeoutMs) : null;
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0 || allowFail) res(out);
      else rej(new Error(`${cmd} ${args.join(" ")}: ${code ?? "killed"} ${out}`));
    });
  });
}

const xgrab = (path) =>
  sh("ffmpeg", ["-loglevel", "error", "-y", "-f", "x11grab", "-video_size", `${SCREEN.w}x${SCREEN.h}`, "-i", display, "-frames:v", "1", path]);

/** Line-based client for VICE's text remote monitor; each command pauses the machine until resume(). */
class Monitor {
  constructor(port) {
    this.port = port;
    this.buf = "";
    this.sock = null;
    this.stopped = false;
  }
  async connect(ms = 30000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const sock = await new Promise((res) => {
        const s = createConnection({ host: "127.0.0.1", port: this.port }, () => res(s));
        s.on("error", () => res(null));
      });
      if (sock) {
        this.sock = sock;
        sock.setEncoding("latin1");
        sock.on("data", (d) => (this.buf += d));
        return;
      }
      await sleep(250);
    }
    throw new Error(`no VICE remote monitor on port ${this.port}`);
  }
  /** Entering the monitor prints a prompt before the output, so a stopped machine answers prompt, output, prompt. */
  async cmd(line, ms = 15000) {
    this.buf = "";
    const prompts = this.stopped ? 1 : 2;
    this.sock.write(`${line}\n`);
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const all = [...this.buf.matchAll(/\([C0-9]{1,2}:\$[0-9a-f]{4}\) /gi)];
      if (all.length >= prompts && /\([C0-9]{1,2}:\$[0-9a-f]{4}\) $/i.test(this.buf)) {
        this.stopped = true;
        const start = prompts === 2 ? all[0].index + all[0][0].length : 0;
        return this.buf.slice(start, all[all.length - 1].index);
      }
      await sleep(20);
    }
    throw new Error(`monitor command timed out: ${line} (got ${JSON.stringify(this.buf.slice(-200))})`);
  }
  resume() {
    this.buf = "";
    this.stopped = false;
    this.sock.write("x\n");
  }
  close() {
    this.sock?.destroy();
  }
}

async function readScreen(mon) {
  const out = await mon.cmd("sc");
  mon.resume();
  const lines = out.split(/\r?\n/);
  const at = lines.findIndex((l) => /Displaying \d+x\d+ screen/.test(l));
  return lines
    .slice(at + 1, at + 26)
    .map((l) => l.replace(/^(\*C:)?[0-9a-f]{4}  /i, "").replace(/\s+$/, "").toUpperCase());
}

async function peek(mon, addr) {
  const out = await mon.cmd(`m ${addr.toString(16)} ${addr.toString(16)}`);
  mon.resume();
  return parseInt(/>C:[0-9a-f]{4}\s+([0-9a-f]{2})/i.exec(out)?.[1] ?? "-1", 16);
}

/**
 * The 1541 at this moment: its CPU registers, the job queue (codes at $00-$05: $80 read pending,
 * $01 OK, $05 data checksum error; track/sector pairs at $06-$11) and the head track ($22).
 */
async function driveState(mon) {
  await mon.cmd("dev 8:");
  const regs = (await mon.cmd("r")).trim().split(/\r?\n/).pop()?.trim() ?? "";
  const dump = await mon.cmd("m 0000 002f");
  await mon.cmd("dev c:");
  mon.resume();
  const zp = [...dump.matchAll(/>[C0-9]{1,2}:[0-9a-f]{4}\s+((?:[0-9a-f]{2}\s+){16})/gi)].flatMap((m) =>
    m[1].trim().split(/\s+/).map((h) => parseInt(h, 16)),
  );
  const jobs = zp.slice(0, 6).map((code, i) => ({ code, track: zp[6 + 2 * i], sector: zp[7 + 2 * i] }));
  return { regs, jobs, headTrack: zp[0x22] };
}

async function resources(mon) {
  const out = {};
  for (const r of DRIVE_RESOURCES) {
    const text = (await mon.cmd(`resget "${r}"`)).trim();
    out[r] = text.includes("=") ? text.slice(text.indexOf("=") + 1).replace(/^"|"$/g, "") : null;
  }
  mon.resume();
  return out;
}

const norm = (s) => s.replace(/\s+/g, "").toUpperCase();

/** Screen lines printed after `command` up to READY.; null while it is still running. */
function outputAfter(lines, command) {
  const n = lines.map(norm);
  const ci = n.lastIndexOf(norm(command));
  const ri = n.lastIndexOf("READY.");
  if (ci >= 0) return ri > ci ? lines.slice(ci + 1, ri + 1).filter((l) => l.trim()) : null;
  const last = lines.filter((l) => l.trim()).pop();
  return last && norm(last) === "READY." ? lines.filter((l) => l.trim()) : null;
}

async function waitReady(mon, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const lines = await readScreen(mon);
    if (lines.some((l) => norm(l) === "READY.")) return lines;
    await sleep(500);
  }
  throw new Error("C64 never reached READY.");
}

async function focus(win) {
  await sh("xdotool", ["windowactivate", "--sync", win], { allowFail: true });
  await sh("xdotool", ["windowfocus", "--sync", win], { allowFail: true });
}

async function press(keysym) {
  await sh("xdotool", ["keydown", keysym]);
  await sleep(keyHoldMs);
  await sh("xdotool", ["keyup", keysym]);
  await sleep(keyGapMs);
}

/** Types `command` key by key, checks the screen line, presses RETURN and waits for READY. */
async function enter(mon, win, command, { ms = 90000, waitForReady = true } = {}) {
  await focus(win);
  for (const ch of command.toLowerCase()) await press(KEYSYM[ch] ?? ch);
  await sleep(300);
  const before = await readScreen(mon);
  const typedOk = before.some((l) => norm(l) === norm(command));
  await press("Return");
  const t0 = Date.now();
  if (!waitForReady) return { command, typedOk, ms: 0, output: [] };
  let lines = before;
  while (Date.now() - t0 < ms) {
    await sleep(700);
    lines = await readScreen(mon);
    const out = outputAfter(lines, command);
    if (out) return { command, typedOk, ms: Date.now() - t0, output: out, screen: lines };
  }
  return { command, typedOk, ms: Date.now() - t0, timeout: true, output: [], screen: lines, drive: await driveState(mon) };
}

function loadOutcome(step) {
  const text = step.output.join("\n");
  if (/FILE NOT FOUND/.test(text)) return "FILE NOT FOUND";
  if (/DEVICE NOT PRESENT/.test(text)) return "DEVICE NOT PRESENT";
  if (/LOADING/.test(text) && /READY\./.test(text)) return "LOADED";
  return step.timeout ? "TIMEOUT" : "OTHER";
}

/** No colons: VICE can turn a typed ":" (Shift on a PC keyboard) into "[" when the shift edge races the C64 scan. */
const ERROR_CHANNEL_PROGRAM = ["10 OPEN1,8,15", "20 INPUT#1,A,B$,C,D", "30 PRINTA;B$;C;D", "40 CLOSE1"];

const bannerUp = (screen) => screen.some((l) => /COMMODORE 64 BASIC V2/.test(l));

/**
 * LOAD"GEOS",8,1, RUN once it is back at READY. (boot files that start themselves skip that),
 * then the deskTop (bitmap mode for three polls in a row), a reset to BASIC, or a timeout.
 */
async function bootGeos(mon, win, dir, label) {
  await focus(win);
  await press("shift+Home");
  await sleep(500);
  const load = await enter(mon, win, 'LOAD"GEOS",8,1', { waitForReady: false });
  const steps = [load];
  let run = null;
  let bitmapPolls = 0;
  let screen = [];
  let end = null;
  const t0 = Date.now();
  while (!end && Date.now() - t0 < 120_000 + deskTopMs) {
    await sleep(2000);
    const d011 = await peek(mon, 0xd011);
    screen = await readScreen(mon);
    bitmapPolls = d011 >= 0 && d011 & 0x20 ? bitmapPolls + 1 : 0;
    if (bitmapPolls >= 3) {
      end = run ? "GEOS deskTop after RUN" : "GEOS deskTop (the boot file started itself)";
      break;
    }
    if (!run) {
      const commandShown = screen.some((l) => norm(l) === norm(load.command));
      if (!commandShown && bannerUp(screen)) end = "C64 reset to BASIC";
      const out = commandShown ? outputAfter(screen, load.command) : null;
      if (!out) continue;
      load.output = out;
      load.ms = Date.now() - t0;
      load.outcome = loadOutcome(load);
      progress(`${label}: LOAD"GEOS",8,1 → ${load.outcome}`);
      if (load.outcome !== "LOADED") {
        end = load.outcome;
        break;
      }
      load.shots = await shoot(mon, dir, "04-load-geos");
      run = await enter(mon, win, "RUN", { waitForReady: false });
      steps.push(run);
    } else if (bannerUp(screen) && !screen.some((l) => norm(l) === "RUN")) {
      end = "C64 reset to BASIC";
    }
  }
  if (!load.outcome) {
    load.outcome = end && /deskTop|reset/.test(end) ? "started without READY." : "TIMEOUT";
    load.ms = Date.now() - t0;
  }
  if (bitmapPolls >= 3) await sleep(20_000);
  const final = { command: "(wait for GEOS)", ms: Date.now() - t0, outcome: end ?? "no deskTop before timeout" };
  if (!/deskTop/.test(final.outcome)) final.textScreen = screen.filter((l) => l.trim());
  if (!end) final.drive = await driveState(mon);
  final.shots = await shoot(mon, dir, "05-geos");
  steps.push(final);
  progress(`${label}: GEOS → ${final.outcome}`);
  return steps;
}

async function shoot(mon, dir, name) {
  const native = join(dir, `${name}.png`);
  const desktop = join(dir, `${name}-desktop.png`);
  await mon.cmd(`scrsh "${native}" 2`);
  mon.resume();
  await xgrab(desktop);
  return { native, desktop };
}

function describe(path, bytes) {
  const info = d64ErrorInfoSummary(bytes);
  const dir = d64Directory(bytes);
  return {
    path,
    name: basename(path),
    bytes: bytes.length,
    sha1: createHash("sha1").update(bytes).digest("hex"),
    errorInfo: info.errorInfo ? { histogram: info.histogram, track18: info.track18, flaggedCount: info.badCount } : null,
    imageDir: { free: dir.free, entries: dir.entries.length },
  };
}

async function runImage(label, path, bytes) {
  const dir = join(shotRoot, label);
  mkdirSync(dir, { recursive: true });
  const home = mkdtempSync(join(tmpdir(), "vice-ref-"));
  for (const d of ["cfg", "state", "cache"]) mkdirSync(join(home, d));
  const work = join(home, basename(path));
  writeFileSync(work, bytes);
  const env = {
    ...process.env,
    DISPLAY: display,
    XDG_CONFIG_HOME: join(home, "cfg"),
    XDG_STATE_HOME: join(home, "state"),
    XDG_CACHE_HOME: join(home, "cache"),
    ...(viceData ? { XDG_DATA_HOME: viceData } : {}),
  };
  const args = [
    "-default",
    "-drive8type", "1541",
    ...(tde ? ["-drive8truedrive", "+virtualdev8"] : ["+drive8truedrive", "-virtualdev8"]),
    "-sounddev", "dummy",
    "-remotemonitor",
    "-remotemonitoraddress", `ip4://127.0.0.1:${monPort}`,
    "-8", work,
  ];
  const vice = spawn(viceBin, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  vice.stdout.on("data", (d) => (log += d));
  vice.stderr.on("data", (d) => (log += d));
  const result = { label, ...describe(path, bytes), vice: { bin: viceBin, version: versionText, args }, steps: [] };
  const mon = new Monitor(monPort);
  try {
    progress(`${label}: starting ${viceBin}`);
    const found = await sh("xdotool", ["search", "--sync", "--all", "--onlyvisible", "--pid", String(vice.pid), "--name", "VICE"], {
      timeoutMs: 30000,
    });
    const win = found.trim().split("\n").pop();
    await sh("xdotool", ["windowmove", win, "0", "0"], { allowFail: true });
    await mon.connect();
    await waitReady(mon);
    await sleep(2500);
    result.driveSettings = await resources(mon);
    result.powerOn = await shoot(mon, dir, "00-power-on");

    const dirLoad = await enter(mon, win, 'LOAD"$",8');
    dirLoad.outcome = loadOutcome(dirLoad);
    dirLoad.shots = await shoot(mon, dir, "01-load-dir");
    result.steps.push(dirLoad);
    progress(`${label}: LOAD"$",8 → ${dirLoad.outcome}`);

    const list = await enter(mon, win, "LIST", { ms: 30000 });
    const freeLine = list.screen?.find((l) => /BLOCKS FREE/.test(l)) ?? null;
    const files = list.output.filter((l) => /^\d+\s+".*"\s+\S{3}/.test(l.trim())).length;
    list.outcome = freeLine ? `listed: ${files} files, ${freeLine.trim()}` : "nothing listed";
    list.shots = await shoot(mon, dir, "02-list");
    result.steps.push(list);
    progress(`${label}: LIST → ${list.outcome}`);

    await enter(mon, win, "NEW", { ms: 10000 });
    const programTyped = [];
    for (const line of ERROR_CHANNEL_PROGRAM) programTyped.push((await enter(mon, win, line, { waitForReady: false })).typedOk);
    await sleep(300);
    const errch = await enter(mon, win, "RUN", { ms: 30000 });
    errch.command = `RUN (${ERROR_CHANNEL_PROGRAM.join(" / ")})`;
    errch.typedOk = errch.typedOk && programTyped.every(Boolean);
    errch.outcome = errch.output.filter((l) => !/^READY\.$/.test(l.trim())).pop()?.trim() ?? "";
    errch.shots = await shoot(mon, dir, "03-error-channel");
    result.steps.push(errch);
    progress(`${label}: error channel → ${errch.outcome}`);

    if (runGeos) result.steps.push(...(await bootGeos(mon, win, dir, label)));
    result.allKeysTyped = result.steps.every((s) => s.typedOk !== false);
  } catch (e) {
    result.error = String(e?.message || e);
    progress(`${label}: ERROR ${result.error}`);
    await xgrab(join(dir, "99-error-desktop.png")).catch(() => {});
  } finally {
    mon.close();
    vice.kill("SIGTERM");
    await new Promise((r) => {
      const t = setTimeout(() => {
        vice.kill("SIGKILL");
        r();
      }, 5000);
      vice.on("close", () => {
        clearTimeout(t);
        r();
      });
    });
    writeFileSync(join(dir, "vice.log"), log);
    rmSync(home, { recursive: true, force: true });
  }
  for (const s of result.steps) delete s.screen;
  return result;
}

async function startDisplay() {
  const running = await sh("xdotool", ["getdisplaygeometry"], { allowFail: true });
  if (/^\d+ \d+/.test(running.trim())) return { xvfb: null, wmProc: null };
  const xvfb = spawn("Xvfb", [display, "-screen", "0", `${SCREEN.w}x${SCREEN.h}x24`, "-ac", "-nolisten", "tcp"], { stdio: "ignore" });
  await sleep(1500);
  let wmProc = null;
  if (wm) {
    wmProc = spawn(wm, ["--compositor=off", "--sm-client-disable"], { env: { ...process.env, DISPLAY: display }, stdio: "ignore" });
    wmProc.on("error", () => {});
    await sleep(1500);
  }
  return { xvfb, wmProc };
}

const { xvfb, wmProc } = await startDisplay();
const report = { vice: versionText, trueDriveEmulation: tde, display, keyHoldMs, keyGapMs, runs: [] };
const seen = new Map();
const runOnce = async (label, path, bytes) => {
  const sha1 = createHash("sha1").update(bytes).digest("hex");
  if (seen.has(sha1)) {
    progress(`${label}: same bytes as ${seen.get(sha1)}, not run again`);
    report.runs.push({ label, path, bytes: bytes.length, sha1, sameAs: seen.get(sha1) });
    return;
  }
  seen.set(sha1, label);
  report.runs.push(await runImage(label, path, bytes));
};
try {
  for (const path of images) {
    const bytes = readFileSync(path);
    const label = basename(path).replace(/\.d64$/i, "");
    await runOnce(label, path, bytes);
    const layout = d64Layout(bytes.length);
    if (runStripped && layout?.errorInfo) {
      const plain = bytes.subarray(0, layout.tracks === 40 ? 196608 : 174848);
      await runOnce(`${label}-stripped`, path.replace(/\.d64$/i, "-stripped.d64"), plain);
    }
  }
} finally {
  wmProc?.kill();
  xvfb?.kill();
}
const outFile = join(outDir, `${slug}.json`);
writeFileSync(outFile, JSON.stringify(report, null, 2));
for (const r of report.runs) {
  console.log(
    JSON.stringify({
      image: r.label,
      bytes: r.bytes,
      sha1: r.sha1,
      ...(r.sameAs
        ? { sameAs: r.sameAs }
        : { track18: r.errorInfo?.track18 ?? "no table", steps: r.steps.map((s) => `${s.command} → ${s.outcome}`), error: r.error }),
    }),
  );
}
console.log(`report: ${outFile}`);
