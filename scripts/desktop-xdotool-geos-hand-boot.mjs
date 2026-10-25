#!/usr/bin/env node
/**
 * Hand gate for GEOS boot disks: real Google Chrome on a reused profile, driven only by
 * X11 input events (xdotool → XTEST) on its own Xvfb display, with an X11 screen grab at
 * every step and an X11 screen recording per run. The script reads the page (screen text,
 * core build, library bytes, About diagnostics) but never drives it.
 *
 * Profile: GROK64_HAND_PROFILE (default ~/.cache/grok64-qa-profiles/desktop-chrome-reused) is
 * reused from run to run. Its first run copies GROK64_HAND_PROFILE_SOURCE (default the VM desktop
 * Chrome profile, which has run many earlier Grok64 builds) and merges Tom's stored settings
 * (TOM_REUSED_PROFILE) into it once. Nothing is cleared or seeded after that. Keep the profile
 * outside the workspace: the dev server reloads the page on every file Chrome writes under it.
 *
 * Per disk (GROK64_HAND_D64: the exact images under test) and JiffyDOS mode:
 *   the library row is compared with the image bytes; when it is missing or differs:
 *     Software → On this device → Remove, then Import through the native file dialog
 *   Settings → JiffyDOS switch, Power off → Power on,
 *   Software → On this device → unit 8 → Insert (the screen has to stay at READY, nothing typed),
 *   click the CRT and type LOAD"$",8 / LIST, then LOAD"GEOS",8,1 / RUN until the GEOS deskTop
 *   is on screen or the C64 resets, then About.
 * GROK64_HAND_EXPECT (one per disk, default desktop) is what desktop VICE x64sc does with the
 * same image and keys: "desktop", or "reset" for copy-protected originals whose protection a D64
 * cannot hold (BOOTING GEOS ..., then the BASIC power-on screen).
 *
 *   GROK64_HAND_D64=/a.d64,/b.d64 GROK64_HAND_EXPECT=reset,desktop node scripts/desktop-xdotool-geos-hand-boot.mjs
 *   GROK64_HAND_JIFFY=off,on   GROK64_HAND_TYPE_DELAY_MS=90   GROK64_HAND_RECORD=0 (no video)
 *   GROK64_XDISPLAY=:98   GROK64_HAND_CHROME=/opt/google/chrome/chrome   GROK64_HAND_WM=xfwm4
 * Default disk: GEOS_2.0.d64 from private-c64/geos (GROK64_GEOS_D64_PATH) when present, else
 * fixtures/geos/GEOS64_en.d64.
 * Output: screenshots/geos-hand-boot/<disk>/<jiffy-off|jiffy-on>/ and
 * artifacts/geos-hand-boot/results.json.
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { seedTomReusedProfile, TOM_REUSED_PROFILE, waitBasicCommand, waitGeosBoot } from "./desktop-qa-lib.mjs";
import { GEOS_EN_PLAIN_NAME, geosD64Fingerprint, resolveGeosD64Path } from "./geos-fixture-lib.mjs";
import { d64Directory, d64ErrorInfoSummary } from "./d64-error-info-lib.mjs";

const cwd = process.cwd();
const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const display = process.env.GROK64_XDISPLAY || ":98";
const modes = (process.env.GROK64_HAND_JIFFY || "off,on").split(",").map((s) => s.trim() === "on");
const typeDelay = String(Number(process.env.GROK64_HAND_TYPE_DELAY_MS || "90"));
const record = process.env.GROK64_HAND_RECORD !== "0";
const deskTopMs = Number(process.env.GROK64_HAND_DESKTOP_MS || "240000");
const profileDir = resolve(
  process.env.GROK64_HAND_PROFILE || join(homedir(), ".cache", "grok64-qa-profiles", "desktop-chrome-reused"),
);
const profileSource = process.env.GROK64_HAND_PROFILE_SOURCE || "/home/ubuntu/.config/google-chrome";
const chromeBin =
  process.env.GROK64_HAND_CHROME || (existsSync("/opt/google/chrome/chrome") ? "/opt/google/chrome/chrome" : undefined);
const wm = process.env.GROK64_HAND_WM ?? "xfwm4";
const SCREEN = { w: 1280, h: 900 };
const WHEEL_NOTCH_PX = 120;
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
  const tom = resolveGeosD64Path(cwd);
  if (existsSync(tom) && !tom.startsWith(join(cwd, "fixtures"))) return [tom];
  return [join(cwd, "fixtures", "geos", GEOS_EN_PLAIN_NAME)];
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

/** LIST output vs the image: the BLOCKS FREE count and every entry still on screen (blocks + type, last first). */
function directoryMatchesImage(screen, dir) {
  const lines = screen.split("\n");
  const freeAt = lines.findLastIndex((l) => /BLOCKS FREE/i.test(l));
  if (freeAt < 0) return { ok: false, reason: "no BLOCKS FREE line" };
  const free = Number(/(\d+)\s+BLOCKS FREE/i.exec(lines[freeAt])?.[1]);
  const shown = [];
  for (let i = freeAt - 1; i >= 0; i--) {
    const m = /^\s*(\d+)\s+".*"\s*\*?(DEL|SEQ|PRG|USR|REL)/.exec(lines[i]);
    if (!m) break;
    shown.unshift({ blocks: Number(m[1]), type: m[2] });
  }
  const tail = dir.entries.slice(-shown.length);
  const entriesMatch = shown.length > 0 && shown.every((e, i) => e.blocks === tail[i]?.blocks && e.type === tail[i]?.type);
  return {
    ok: free === dir.free && entriesMatch,
    free,
    imageFree: dir.free,
    entriesOnScreen: shown.length,
    imageEntries: dir.entries.length,
    entriesMatch,
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sh(cmd, args, { allowFail = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: { ...process.env, DISPLAY: display }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout?.on("data", (d) => (out += d));
    p.stderr?.on("data", (d) => (out += d));
    p.on("close", (code) => {
      if (code === 0 || allowFail) resolve(out);
      else reject(new Error(`${cmd} ${args.join(" ")}: ${out}`));
    });
  });
}

const xgrab = (path) =>
  sh("ffmpeg", ["-loglevel", "error", "-y", "-f", "x11grab", "-video_size", `${SCREEN.w}x${SCREEN.h}`, "-i", display, "-frames:v", "1", path]);

function startRecording(path) {
  const p = spawn(
    "ffmpeg",
    ["-loglevel", "error", "-y", "-f", "x11grab", "-framerate", "8", "-video_size", `${SCREEN.w}x${SCREEN.h}`, "-i", display,
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", path],
    { env: { ...process.env, DISPLAY: display }, stdio: ["pipe", "ignore", "ignore"] },
  );
  return async () => {
    p.stdin.write("q");
    p.stdin.end();
    await new Promise((r) => p.on("close", r));
  };
}

/** First run: copy of the long-used desktop profile plus Tom's stored settings; later runs reuse it as is. */
function openProfile() {
  const marker = join(profileDir, "grok64-gate.json");
  if (existsSync(marker)) return { marker, ...JSON.parse(readFileSync(marker, "utf8")) };
  mkdirSync(profileDir, { recursive: true });
  const copied = existsSync(profileSource);
  if (copied) {
    cpSync(profileSource, profileDir, {
      recursive: true,
      filter: (src) =>
        !/Singleton(Lock|Socket|Cookie)$/.test(src) &&
        !/\/(Crashpad|ShaderCache|GrShaderCache|GraphiteDawnCache|component_crx_cache)(\/|$)/.test(src),
    });
  }
  const prefsPath = join(profileDir, "Default", "Preferences");
  if (existsSync(prefsPath)) {
    // The source browser is still running, so its copy reads as crashed; the restore bubble would cover the header.
    const prefs = JSON.parse(readFileSync(prefsPath, "utf8"));
    prefs.profile = { ...(prefs.profile ?? {}), exit_type: "Normal", exited_cleanly: true };
    writeFileSync(prefsPath, JSON.stringify(prefs));
  }
  const meta = { createdAt: new Date().toISOString(), copiedFrom: copied ? profileSource : null, tomSettingsMerged: false, runs: 0 };
  writeFileSync(marker, JSON.stringify(meta, null, 2));
  return { marker, ...meta };
}

function saveProfileMeta(profile) {
  const { marker, ...meta } = profile;
  writeFileSync(marker, JSON.stringify(meta, null, 2));
}

async function screenText(page) {
  return page.evaluate(() => window.__g64?.screenText?.() ?? "").catch(() => "");
}

/** Polls until a screen line reads exactly `command` (spaces ignored): no key lost or doubled. */
async function waitTypedLine(page, command, maxMs = 6000) {
  const want = command.replace(/\s+/g, "").toUpperCase();
  const t0 = Date.now();
  let text = "";
  while (Date.now() - t0 < maxMs) {
    text = await screenText(page);
    const line = text.split("\n").find((l) => l.replace(/\s+/g, "").toUpperCase() === want);
    if (line) return { found: true, line: line.trim(), ms: Date.now() - t0 };
    await sleep(150);
  }
  return { found: false, screen: text.split("\n").filter((l) => l.trim()).slice(-6).join(" | ") };
}

async function waitFor(fn, ms, step = 300) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await sleep(step);
  }
  return null;
}

/** Library rows with the SHA-1 of their stored bytes (read-only; no database is created). */
async function libraryRows(page) {
  return page.evaluate(async () => {
    const dbs = indexedDB.databases ? await indexedDB.databases() : [];
    if (!dbs.some((d) => d.name === "grok64")) return [];
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("grok64");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    try {
      if (!db.objectStoreNames.contains("files")) return [];
      const rows = await new Promise((res, rej) => {
        const q = db.transaction("files", "readonly").objectStore("files").getAll();
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      });
      const out = [];
      for (const r of rows) {
        const buf = r.data instanceof ArrayBuffer ? r.data : r.data?.buffer ?? null;
        const sha1 = buf
          ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", buf)), (b) => b.toString(16).padStart(2, "0")).join("")
          : null;
        out.push({ id: r.id, name: r.name, size: r.size, sha1 });
      }
      return out;
    } finally {
      db.close();
    }
  });
}

async function coreStatus(page) {
  return page.evaluate(() => {
    const s = window.__g64?.grok64Core?.();
    return s
      ? { buildIdLoaded: s.coreBuildIdLoaded, buildMatches: s.coreBuildMatches, glueSha12: s.loadedGlueSha12 }
      : null;
  });
}

async function runAll() {
  const profile = openProfile();
  profile.runs = (profile.runs ?? 0) + 1;
  saveProfileMeta(profile);
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    executablePath: chromeBin,
    viewport: null,
    env: { ...process.env, DISPLAY: display },
    args: [
      "--no-sandbox",
      "--test-type",
      "--disable-dev-shm-usage",
      "--password-store=basic",
      "--no-first-run",
      "--no-default-browser-check",
      "--use-gl=angle",
      "--use-angle=swiftshader-webgl",
      `--window-size=${SCREEN.w},${SCREEN.h}`,
      "--window-position=0,0",
      "--hide-crash-restore-bubble",
    ],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e?.message || e)));
  let navigations = 0;
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) navigations++;
  });

  const run = {
    profile: { dir: profileDir, createdAt: profile.createdAt, copiedFrom: profile.copiedFrom, runs: profile.runs },
    chrome: chromeBin ?? "playwright-chromium",
    display,
    wm: wm || null,
    typeDelayMs: Number(typeDelay),
    manifest: { buildId: manifest.buildId, glueSha12: manifest.glueSha12 },
    disks: [],
  };

  /** The app may reload itself while it starts (stale core cache purge), so retry across navigations. */
  const appReady = async () => {
    const ok = await waitFor(async () => {
      await page.waitForLoadState("domcontentloaded");
      return page.evaluate(() => typeof window.__g64?.power === "function");
    }, 60_000, 500);
    if (!ok) throw new Error("app did not start");
    await sleep(1500);
  };

  let off = null;
  let shotDir = shotRoot;
  let trace = null;
  const shot = async (name) => {
    await xgrab(join(shotDir, name));
    trace?.steps.push({ shot: name });
  };
  const xmove = async (x, y) => {
    const tx = Math.round(x + off.x);
    const ty = Math.round(y + off.y);
    // `mousemove --sync` onto the spot the pointer already has waits ~15 s for a motion that never comes.
    const at = /X=(\d+)\s+Y=(\d+)/.exec(await sh("xdotool", ["getmouselocation", "--shell"]));
    if (at && Number(at[1]) === tx && Number(at[2]) === ty) return;
    await sh("xdotool", ["mousemove", "--sync", String(tx), String(ty)]);
  };
  const firstVisible = async (locator) => {
    for (const l of await locator.all()) if (await l.isVisible().catch(() => false)) return l;
    return null;
  };
  /**
   * Where the element can be seen: the viewport cut down by every clipping ancestor (a row scrolled
   * out of the library list is still inside the viewport), plus what a click at its centre would hit.
   */
  const visibleBox = (locator) =>
    locator.evaluate(
      (el) => {
        const r = el.getBoundingClientRect();
        const clip = { top: 0, left: 0, bottom: innerHeight, right: innerWidth };
        for (let p = el.parentElement; p; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (!/(auto|scroll|hidden|clip)/.test(`${cs.overflowX} ${cs.overflowY}`)) continue;
          const pr = p.getBoundingClientRect();
          clip.top = Math.max(clip.top, pr.top);
          clip.left = Math.max(clip.left, pr.left);
          clip.bottom = Math.min(clip.bottom, pr.bottom);
          clip.right = Math.min(clip.right, pr.right);
        }
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const onTarget = Boolean(hit && (hit === el || el.contains(hit)));
        return {
          box: { x: r.left, y: r.top, width: r.width, height: r.height },
          clip,
          inside:
            r.width > 0 &&
            r.height > 0 &&
            r.top >= clip.top - 0.5 &&
            r.bottom <= clip.bottom + 0.5 &&
            r.left >= clip.left - 0.5 &&
            r.right <= clip.right + 0.5,
          onTarget,
          covering: hit && !onTarget ? `${hit.tagName.toLowerCase()}.${String(hit.className).trim().split(/\s+/).join(".")}` : null,
        };
      },
      undefined,
      { timeout: 10_000 },
    );
  /** Mouse-wheel the list it sits in until the element is fully in view and nothing covers its centre. */
  const reveal = async (locator, label) => {
    let covered = 0;
    for (let i = 0; i < 60; i++) {
      const v = await visibleBox(locator).catch(() => null);
      if (v?.inside && v.onTarget) return v.box;
      if (v?.inside) {
        // In view but under something else (a sheet still closing): scrolling will not help.
        if (++covered >= 20) throw new Error(`${label} is covered by ${v.covering}`);
        await sleep(250);
        continue;
      }
      const clip = v?.clip ?? { top: 0, left: 0, bottom: SCREEN.h / 2, right: SCREEN.w };
      await xmove((clip.left + clip.right) / 2, (clip.top + clip.bottom) / 2);
      const dist = v ? v.box.y + v.box.height / 2 - (clip.top + clip.bottom) / 2 : clip.bottom - clip.top;
      // Chrome scrolls 120 px per wheel notch: aim the centre of the element at the centre of its list.
      const notches = Math.min(8, Math.max(1, Math.round(Math.abs(dist) / WHEEL_NOTCH_PX)));
      await sh("xdotool", ["click", "--repeat", String(notches), "--delay", "30", dist > 0 ? "5" : "4"]);
      await sleep(250);
    }
    throw new Error(`could not scroll to ${label}`);
  };
  /** Sheets slide in: wait until the element stops moving before aiming at it. */
  const stableBox = async (locator) => {
    let prev = null;
    for (let i = 0; i < 40; i++) {
      const b = await locator.boundingBox();
      if (b && prev && ["x", "y", "width", "height"].every((k) => Math.abs(b[k] - prev[k]) < 0.5)) return b;
      prev = b;
      await sleep(120);
    }
    return prev;
  };
  const click = async (locator, label, { settle = 120 } = {}) => {
    await reveal(locator, label);
    await stableBox(locator);
    const box = await reveal(locator, label);
    await xmove(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(settle);
    await sh("xdotool", ["click", "1"]);
    trace?.steps.push({ click: label });
  };
  const key = async (...keys) => sh("xdotool", ["key", "--delay", typeDelay, ...keys]);
  const type = async (text) => sh("xdotool", ["type", "--delay", typeDelay, "--", text]);
  const crt = () => page.locator(".g64-screen").first();
  /** Click the CRT, then type at once (the first key lands right after the click). */
  const clickCrtAndType = async (line) => {
    await click(crt(), "crt", { settle: 60 });
    await sleep(60);
    await type(line);
    await key("Return");
    trace?.steps.push({ typed: line });
  };
  const sheetOpen = () => page.locator(".g64-sheet").first().isVisible().catch(() => false);
  const openLibrary = async () => {
    await click(page.locator('button[aria-label="Software"]').first(), "Software");
    await page.locator(".g64-sheet").first().waitFor({ state: "visible", timeout: 15_000 });
    const tab = page.locator(".g64-seg button").filter({ hasText: /^On this device/ }).first();
    for (let i = 0; i < 3 && (await tab.getAttribute("data-on")) !== "true"; i++) {
      await click(tab, "On this device");
      await sleep(400);
    }
    if ((await tab.getAttribute("data-on")) !== "true") throw new Error("On this device tab did not open");
  };
  const closeSheet = async () => {
    if (!(await sheetOpen())) return;
    await key("Escape");
    await waitFor(async () => !(await sheetOpen()), 5000);
  };
  const headerButton = async (labelText) => {
    let btn = await firstVisible(page.locator(`button[aria-label="${labelText}"]`));
    if (!btn) {
      const more = await firstVisible(page.locator('button[aria-label="More"]'));
      if (more) {
        await click(more, "More");
        btn = await waitFor(() => firstVisible(page.locator(`button[aria-label="${labelText}"]`)), 3000);
      }
    }
    if (!btn) throw new Error(`no visible ${labelText} button`);
    return btn;
  };
  const waitReady = (ms) =>
    waitFor(async () => {
      const on = await page.evaluate(() => window.__g64?.running?.() && !window.__g64?.booting?.());
      return on && /READY\./.test(await screenText(page));
    }, ms, 500);

  /** Remove stale rows of this name through the UI and import the image through the native file dialog. */
  const ensureInLibrary = async (disk) => {
    const rows = (await libraryRows(page)).filter((r) => r.name === disk.name);
    const good = rows.filter((r) => r.sha1 === disk.sha1);
    if (rows.length === 1 && good.length === 1) return { imported: false, rowSha1: good[0].sha1 };
    await openLibrary();
    for (let i = 0; i < rows.length; i++) {
      await click(page.getByRole("button", { name: `Remove ${disk.name}`, exact: true }).first(), `Remove ${disk.name}`);
      await sleep(600);
    }
    const left = (await libraryRows(page)).filter((r) => r.name === disk.name).length;
    if (left) throw new Error(`${left} old ${disk.name} rows still in the library`);
    await click(page.locator(".g64-actions button").filter({ hasText: /^Import$/ }).first(), "Import");
    const win = await waitFor(async () => {
      const out = await sh("xdotool", ["search", "--onlyvisible", "--name", "^Open"], { allowFail: true });
      return out.trim().split("\n").filter(Boolean).pop() || null;
    }, 15_000, 400);
    if (!win) throw new Error("native file dialog did not open");
    await sh("xdotool", ["windowactivate", "--sync", win], { allowFail: true });
    await sh("xdotool", ["windowfocus", "--sync", win], { allowFail: true });
    await sleep(600);
    await shot("00-import-dialog.png");
    await key("ctrl+l");
    await sleep(300);
    await sh("xdotool", ["type", "--delay", "25", "--", disk.path]);
    await sleep(400);
    await shot("00-import-path.png");
    // Return in the GTK location field cancels Chrome's chooser; a user clicks Open (bottom right).
    const geom = await sh("xdotool", ["getwindowgeometry", win]);
    const m = /Position: (-?\d+),(-?\d+).*Geometry: (\d+)x(\d+)/s.exec(geom);
    if (!m) throw new Error(`file dialog geometry: ${geom}`);
    const [wx, wy, ww, wh] = m.slice(1).map(Number);
    await sh("xdotool", ["mousemove", "--sync", String(wx + ww - 50), String(wy + wh - 10)]);
    await sleep(300);
    await shot("00-import-open.png");
    await sh("xdotool", ["click", "1"]);
    const row = await waitFor(async () => (await libraryRows(page)).find((r) => r.name === disk.name && r.sha1 === disk.sha1), 30_000, 500);
    if (!row) throw new Error(`import did not store ${disk.name} with sha1 ${disk.sha1}`);
    await waitReady(180_000);
    await sleep(1500);
    await shot("00-imported-played.png");
    return { imported: true, rowSha1: row.sha1 };
  };

  const setJiffy = async (want) => {
    await click(await headerButton("Settings"), "Settings");
    const row = page.locator(".g64-row").filter({ hasText: "JiffyDOS (needs C64 + 1541 ROMs)" }).first();
    await row.waitFor({ state: "attached", timeout: 15_000 });
    const sw = row.locator('button[role="switch"]').first();
    await reveal(sw, "JiffyDOS switch");
    const before = (await sw.getAttribute("aria-checked")) === "true";
    if (before !== want) await click(sw, `JiffyDOS switch → ${want ? "on" : "off"}`);
    await sleep(400);
    const after = (await sw.getAttribute("aria-checked")) === "true";
    await shot("01-settings-jiffy.png");
    await closeSheet();
    if (after !== want) throw new Error(`JiffyDOS switch stayed ${after ? "on" : "off"}`);
    return { before, after };
  };

  const powerCycle = async () => {
    const navBefore = navigations;
    if (await page.evaluate(() => window.__g64?.powered?.() || window.__g64?.booting?.())) {
      await click(await headerButton("Power off"), "Power off");
      await page.locator(".g64-splash").first().waitFor({ state: "visible", timeout: 30_000 });
      await sleep(800);
      await shot("02-power-off.png");
    }
    await click(page.locator(".g64-power").first(), "Power on");
    const ready = await waitReady(180_000);
    await sleep(1500);
    await shot("02-power-on-ready.png");
    return { ready: Boolean(ready), reloads: navigations - navBefore };
  };

  const openAbout = async () => {
    await click(await headerButton("About"), "About");
    await sleep(1500);
    await shot("08-about.png");
    await key("Escape");
    await sleep(500);
  };

  const runMode = async (disk, jiffy) => {
    const mode = jiffy ? "jiffy-on" : "jiffy-off";
    shotDir = join(shotRoot, disk.name.replace(/\.d64$/i, ""), mode);
    rmSync(shotDir, { recursive: true, force: true });
    mkdirSync(shotDir, { recursive: true });
    trace = { disk: disk.name, mode, jiffy, steps: [] };
    const stopRecording = record ? startRecording(join(shotDir, `hand-boot-${mode}.mp4`)) : null;
    try {
      if (!(await page.evaluate(() => window.__g64?.running?.()))) {
        await click(page.locator(".g64-power").first(), "Power on");
        await waitReady(180_000);
      }
      trace.library = await ensureInLibrary(disk);
      trace.jiffySwitch = await setJiffy(jiffy);
      trace.power = await powerCycle();
      if (!trace.power.ready) throw new Error("no READY after Power on");
      trace.banner = (await screenText(page)).split("\n").filter((l) => l.trim()).slice(0, 3).join(" | ");
      trace.jiffyLive = await page.evaluate(() => window.__g64?.jiffyLive?.() ?? null);
      trace.core = await coreStatus(page);
      trace.coreOk = trace.core?.buildIdLoaded === manifest.buildId && trace.core?.buildMatches === true;
      trace.sessionFlags = await page.evaluate(() => window.__g64?.sessionFlags?.() ?? null);

      const rowBefore = (await libraryRows(page)).find((r) => r.name === disk.name);
      trace.librarySha1AtInsert = rowBefore?.sha1 ?? null;
      trace.exactMedia = rowBefore?.sha1 === disk.sha1;
      await openLibrary();
      const card = page.locator(".g64-card").filter({ has: page.getByText(disk.name, { exact: true }) }).first();
      await card.waitFor({ state: "attached", timeout: 30_000 });
      await click(card.getByRole("group", { name: /IEC drive unit/i }).getByRole("button", { name: "8", exact: true }), "unit 8");
      await sleep(300);
      const insert = page.getByRole("button", { name: `Insert ${disk.name}`, exact: true });
      await insert.waitFor({ state: "attached", timeout: 30_000 });
      await reveal(insert, `Insert ${disk.name}`);
      await shot("03-library-row.png");
      const loadsBefore = ((await screenText(page)).match(/LOAD/g) ?? []).length;
      const insertToast = () =>
        page.evaluate(() =>
          Array.from(document.querySelectorAll("[data-sonner-toast]"), (t) => t.textContent?.trim() ?? "").find((t) =>
            /^Inserted .+ on drive 8$/.test(t),
          ) ?? null,
        );
      // A toast left from an earlier insert would vouch for a click that missed.
      if (!(await waitFor(async () => !(await insertToast()), 15_000, 300))) {
        throw new Error('an earlier "Inserted … on drive 8" toast is still showing');
      }
      await click(insert, `Insert ${disk.name}`);
      if (!(await waitFor(async () => !(await sheetOpen()), 15_000))) {
        throw new Error(`clicking Insert ${disk.name} did not close the Software sheet`);
      }
      trace.insertToast = await waitFor(insertToast, 60_000, 200);
      if (!trace.insertToast) throw new Error(`no "Inserted … on drive 8" toast after clicking Insert ${disk.name}`);
      trace.mountedAfterInsert = await page.evaluate(() => window.__g64?.media?.() ?? null);
      trace.insertedExact = Boolean(
        trace.mountedAfterInsert?.some((m) => m.name === disk.name && m.size === disk.bytes),
      );
      await waitReady(180_000);
      await sleep(4000);
      const afterInsert = await screenText(page);
      trace.insertLeftReady =
        /READY\./.test(afterInsert) && ((afterInsert.match(/LOAD/g) ?? []).length === loadsBefore);
      await shot("03-inserted-ready.png");

      await clickCrtAndType('LOAD"$",8');
      trace.loadDollarLine = await waitTypedLine(page, 'LOAD"$",8');
      trace.loadDollar = await waitBasicCommand(page, 'LOAD"$",8', 120_000);
      if (trace.loadDollar.error) {
        const d = await page.evaluate(() => window.__g64?.captureLoadDollarDiag?.(8) ?? null);
        trace.loadDollarDiag = d && { errorInfo: d.errorInfo, dos1541: d.dos1541, imgBamDiskName: d.imgBamDiskName };
      }
      await type("LIST");
      await key("Return");
      let listed = "";
      await waitFor(async () => {
        listed = await screenText(page);
        return /BLOCKS FREE|FILE NOT FOUND|\?\w+ +ERROR/i.test(screenTextAfterList(listed));
      }, 60_000, 1000);
      await sleep(1500);
      listed = await screenText(page);
      trace.directory = directoryMatchesImage(listed, disk.dir);
      trace.directoryOk = trace.loadDollarLine.found && !trace.loadDollar.error && trace.directory.ok;
      trace.listScreen = listed.slice(0, 1200);
      await shot("04-directory.png");

      await key("shift+Home");
      await sleep(600);
      await clickCrtAndType('LOAD"GEOS",8,1');
      trace.loadGeosLine = await waitTypedLine(page, 'LOAD"GEOS",8,1');
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
          if (!bootingShot && /BOOTING GEOS/i.test(await screenText(page))) {
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
      trace.outcome = boot.deskTop?.pass ? "desktop" : boot.deskTop?.reset ? "reset" : "no-desktop";
      await sleep(2000);
      await shot(trace.outcome === "desktop" ? "07-desktop.png" : `07-${trace.outcome}.png`);
      await openAbout();
      trace.pageErrors = errors.splice(0).slice(0, 5);
      trace.expect = disk.expect;
      trace.pass = Boolean(
        trace.coreOk &&
          trace.exactMedia &&
          trace.insertedExact &&
          trace.insertLeftReady &&
          trace.directoryOk &&
          trace.firstKeyAfterClickOk &&
          !trace.loadGeos?.error &&
          trace.outcome === disk.expect,
      );
    } catch (e) {
      trace.error = String(e?.message || e);
      trace.pass = false;
      await xgrab(join(shotDir, "99-error.png")).catch(() => {});
      await closeSheet().catch(() => {});
    } finally {
      if (stopRecording) await stopRecording().catch(() => {});
    }
    return trace;
  };

  /** Page CSS px → X screen px, measured with real pointer moves. */
  const calibrate = async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      await appReady();
      const p = await (async () => {
        await page.evaluate(() => {
          window.__handPos = null;
          window.addEventListener("mousemove", (e) => (window.__handPos = { x: e.clientX, y: e.clientY }), true);
        });
        const tx = 420 + attempt * 13;
        for (const [x, y] of [[400, 400], [tx, 430]]) {
          await sh("xdotool", ["mousemove", "--sync", String(x), String(y)]);
          await sleep(250);
        }
        const pos = await page.evaluate(() => window.__handPos);
        return pos && { x: tx - pos.x, y: 430 - pos.y };
      })().catch(() => null);
      if (p) return p;
      await sleep(1500);
    }
    await xgrab(join(shotRoot, "calibration-failed.png")).catch(() => {});
    throw new Error("calibration: no mousemove reached the page");
  };

  try {
    if (!profile.tomSettingsSeeded) {
      // Written while no app page is open: a running page persists its whole settings state on any store update.
      const seedUrl = new URL("grok64-gate-seed", base).href;
      await page.route(seedUrl, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>seed</title>" }));
      await page.goto(seedUrl);
      await seedTomReusedProfile(page, { jiffyDos: false });
      await page.unroute(seedUrl);
      profile.tomSettingsSeeded = new Date().toISOString();
      saveProfileMeta(profile);
    }
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await appReady();
    run.startup = {
      navigations,
      coreCacheAutoReload: await page.evaluate(() => sessionStorage.getItem("grok64.coreCacheAutoReload")),
    };
    run.storedSettings = await page.evaluate(
      () => JSON.parse(localStorage.getItem("grok64-settings") || "null")?.state ?? null,
    );
    const tomKeys = ["machineId", "videoStandard", "coreMode", "driveMode", "reuSize", "mouseMode", "iecMap", "iecDrive", "iecUnit"];
    run.tomSettingsDrift = tomKeys
      .filter((k) => JSON.stringify(run.storedSettings?.[k]) !== JSON.stringify(TOM_REUSED_PROFILE[k]))
      .map((k) => ({ key: k, want: TOM_REUSED_PROFILE[k], stored: run.storedSettings?.[k] }));
    if (run.tomSettingsDrift.length) throw new Error(`stored settings drifted from Tom's: ${JSON.stringify(run.tomSettingsDrift)}`);
    await page.bringToFront();
    off = await calibrate();
    run.calibration = off;

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
            error: t.error,
          }),
        );
      }
    }
  } catch (e) {
    run.error = String(e?.message || e);
    console.log(JSON.stringify({ error: run.error }));
  } finally {
    await context.close().catch(() => {});
  }
  return run;
}

function screenTextAfterList(text) {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*LIST\s*$/i.test(lines[i])) return lines.slice(i + 1).join("\n");
  }
  return "";
}

let xvfb;
let wmProc;
let run;
try {
  xvfb = spawn("Xvfb", [display, "-screen", "0", `${SCREEN.w}x${SCREEN.h}x24`, "-ac", "-nolisten", "tcp"], { stdio: "ignore" });
  await sleep(1000);
  if (wm) {
    wmProc = spawn(wm, ["--compositor=off", "--sm-client-disable"], { env: { ...process.env, DISPLAY: display }, stdio: "ignore" });
    await sleep(1500);
  }
  run = await runAll();
} finally {
  wmProc?.kill("SIGTERM");
  xvfb?.kill("SIGTERM");
}
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
