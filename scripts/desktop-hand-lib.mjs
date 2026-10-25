/**
 * Hand-gate plumbing: real Google Chrome on a reused profile, driven only by X11 input events
 * (xdotool → XTEST) on its own Xvfb display, with an X11 screen grab per step and an X11 screen
 * recording per run. Gates read the page (screen text, core build, library rows, stored settings)
 * but never drive it.
 *
 * Profile: GROK64_HAND_PROFILE (default ~/.cache/grok64-qa-profiles/desktop-chrome-reused) is
 * reused from run to run. Its first run copies GROK64_HAND_PROFILE_SOURCE (default the VM desktop
 * Chrome profile, which has run many earlier Grok64 builds) and merges Tom's stored settings
 * (TOM_REUSED_PROFILE) into it once. Nothing is cleared or seeded after that, and every gate starts
 * by checking that Tom's machine and drive settings are still the stored ones. Keep the profile
 * outside the workspace: the dev server reloads the page on every file Chrome writes under it.
 *
 *   GROK64_XDISPLAY=:98   GROK64_HAND_CHROME=/opt/google/chrome/chrome   GROK64_HAND_WM=xfwm4
 *   GROK64_HAND_TYPE_DELAY_MS=90   GROK64_HAND_RECORD=0 (no video)   GROK64_BASE_URL=http://127.0.0.1:8080/
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { seedTomReusedProfile, TOM_REUSED_PROFILE } from "./desktop-qa-lib.mjs";

export const SCREEN = { w: 1280, h: 900 };
const WHEEL_NOTCH_PX = 120;
/** Stored settings a gate must find as Tom left them (machine, video, drives). */
export const TOM_SETTINGS_KEYS = [
  "machineId",
  "videoStandard",
  "coreMode",
  "driveMode",
  "reuSize",
  "mouseMode",
  "iecMap",
  "iecDrive",
  "iecUnit",
];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn, ms, step = 300) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await sleep(step);
  }
  return null;
}

export function handConfig(env = process.env) {
  return {
    base: env.GROK64_BASE_URL || "http://127.0.0.1:8080/",
    display: env.GROK64_XDISPLAY || ":98",
    typeDelay: String(Number(env.GROK64_HAND_TYPE_DELAY_MS || "90")),
    record: env.GROK64_HAND_RECORD !== "0",
    profileDir: resolve(
      env.GROK64_HAND_PROFILE || join(homedir(), ".cache", "grok64-qa-profiles", "desktop-chrome-reused"),
    ),
    profileSource: env.GROK64_HAND_PROFILE_SOURCE || "/home/ubuntu/.config/google-chrome",
    chromeBin:
      env.GROK64_HAND_CHROME || (existsSync("/opt/google/chrome/chrome") ? "/opt/google/chrome/chrome" : undefined),
    wm: env.GROK64_HAND_WM ?? "xfwm4",
  };
}

/** Runs `fn` with an Xvfb display and a window manager (the native file dialog needs one) up. */
export async function withHandDisplay(cfg, fn) {
  let xvfb;
  let wmProc;
  try {
    xvfb = spawn("Xvfb", [cfg.display, "-screen", "0", `${SCREEN.w}x${SCREEN.h}x24`, "-ac", "-nolisten", "tcp"], {
      stdio: "ignore",
    });
    await sleep(1000);
    if (cfg.wm) {
      wmProc = spawn(cfg.wm, ["--compositor=off", "--sm-client-disable"], {
        env: { ...process.env, DISPLAY: cfg.display },
        stdio: "ignore",
      });
      await sleep(1500);
    }
    return await fn();
  } finally {
    wmProc?.kill("SIGTERM");
    xvfb?.kill("SIGTERM");
  }
}

function shOn(display, cmd, args, { allowFail = false } = {}) {
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

/** First run: copy of the long-used desktop profile; later runs reuse it as is. */
function openProfile(cfg) {
  const marker = join(cfg.profileDir, "grok64-gate.json");
  if (existsSync(marker)) return { marker, ...JSON.parse(readFileSync(marker, "utf8")) };
  mkdirSync(cfg.profileDir, { recursive: true });
  const copied = existsSync(cfg.profileSource);
  if (copied) {
    cpSync(cfg.profileSource, cfg.profileDir, {
      recursive: true,
      filter: (src) =>
        !/Singleton(Lock|Socket|Cookie)$/.test(src) &&
        !/\/(Crashpad|ShaderCache|GrShaderCache|GraphiteDawnCache|component_crx_cache)(\/|$)/.test(src),
    });
  }
  const prefsPath = join(cfg.profileDir, "Default", "Preferences");
  if (existsSync(prefsPath)) {
    // The source browser is still running, so its copy reads as crashed; the restore bubble would cover the header.
    const prefs = JSON.parse(readFileSync(prefsPath, "utf8"));
    prefs.profile = { ...(prefs.profile ?? {}), exit_type: "Normal", exited_cleanly: true };
    writeFileSync(prefsPath, JSON.stringify(prefs));
  }
  const meta = {
    createdAt: new Date().toISOString(),
    copiedFrom: copied ? cfg.profileSource : null,
    tomSettingsMerged: false,
    runs: 0,
  };
  writeFileSync(marker, JSON.stringify(meta, null, 2));
  return { marker, ...meta };
}

function saveProfileMeta(profile) {
  const { marker, ...meta } = profile;
  writeFileSync(marker, JSON.stringify(meta, null, 2));
}

/** Text after the last LIST line on the C64 screen. */
export function screenTextAfterList(text) {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*LIST\s*$/i.test(lines[i])) return lines.slice(i + 1).join("\n");
  }
  return "";
}

/**
 * LIST output vs a D64 directory (`d64Directory`): the BLOCKS FREE count and every entry still on
 * screen (blocks + type, last first).
 */
export function directoryMatchesImage(screen, dir) {
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
  const entriesMatch =
    shown.length > 0 && shown.every((e, i) => e.blocks === tail[i]?.blocks && e.type === tail[i]?.type);
  return {
    ok: free === dir.free && entriesMatch,
    free,
    imageFree: dir.free,
    entriesOnScreen: shown.length,
    imageEntries: dir.entries.length,
    entriesMatch,
  };
}

/** Reads a drive's error channel the way a user would; scripts/vice-desktop-reference.mjs types the unit 8 one. */
export function errorChannelProgram(unit = 8) {
  return [`10 OPEN1,${unit},15`, "20 INPUT#1,A,B$,C,D", "30 PRINTA;B$;C;D", "40 CLOSE1"];
}

export async function openHand(cfg, { shotDir: firstShotDir }) {
  const profile = openProfile(cfg);
  profile.runs = (profile.runs ?? 0) + 1;
  saveProfileMeta(profile);
  const context = await chromium.launchPersistentContext(cfg.profileDir, {
    headless: false,
    executablePath: cfg.chromeBin,
    viewport: null,
    env: { ...process.env, DISPLAY: cfg.display },
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

  const typeDelay = cfg.typeDelay;
  const sh = (cmd, args, opts) => shOn(cfg.display, cmd, args, opts);
  let off = null;
  let shotDir = firstShotDir;
  let trace = null;
  const note = (step) => trace?.steps.push(step);

  const xgrab = (path) =>
    sh("ffmpeg", [
      "-loglevel", "error", "-y", "-f", "x11grab", "-video_size", `${SCREEN.w}x${SCREEN.h}`, "-i", cfg.display,
      "-frames:v", "1", path,
    ]);
  const startRecording = (path) => {
    const p = spawn(
      "ffmpeg",
      ["-loglevel", "error", "-y", "-f", "x11grab", "-framerate", "8", "-video_size", `${SCREEN.w}x${SCREEN.h}`,
        "-i", cfg.display, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", path],
      { env: { ...process.env, DISPLAY: cfg.display }, stdio: ["pipe", "ignore", "ignore"] },
    );
    return async () => {
      p.stdin.write("q");
      p.stdin.end();
      await new Promise((r) => p.on("close", r));
    };
  };
  const shot = async (name) => {
    await xgrab(join(shotDir, name));
    note({ shot: name });
  };

  const screenText = () => page.evaluate(() => window.__g64?.screenText?.() ?? "").catch(() => "");
  /** Polls until `test(screen)` holds; returns the screen text, or null on timeout. */
  const waitScreen = async (test, ms, step = 500) => {
    let text = "";
    const hit = await waitFor(async () => {
      text = await screenText();
      return test(text) ? true : null;
    }, ms, step);
    return hit ? text : null;
  };
  /** Polls until a screen line reads exactly `command` (spaces ignored): no key lost or doubled. */
  const waitTypedLine = async (command, maxMs = 6000) => {
    const want = command.replace(/\s+/g, "").toUpperCase();
    const t0 = Date.now();
    let text = "";
    while (Date.now() - t0 < maxMs) {
      text = await screenText();
      const line = text.split("\n").find((l) => l.replace(/\s+/g, "").toUpperCase() === want);
      if (line) return { found: true, line: line.trim(), ms: Date.now() - t0 };
      await sleep(150);
    }
    return { found: false, screen: text.split("\n").filter((l) => l.trim()).slice(-6).join(" | ") };
  };

  /** Library rows with the SHA-1 of their stored bytes (read-only; no database is created). */
  const libraryRows = () =>
    page.evaluate(async () => {
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
            ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", buf)), (b) =>
                b.toString(16).padStart(2, "0"),
              ).join("")
            : null;
          out.push({ id: r.id, name: r.name, size: r.size, sha1 });
        }
        return out;
      } finally {
        db.close();
      }
    });

  const coreStatus = () =>
    page.evaluate(() => {
      const s = window.__g64?.grok64Core?.();
      return s
        ? { buildIdLoaded: s.coreBuildIdLoaded, buildMatches: s.coreBuildMatches, glueSha12: s.loadedGlueSha12 }
        : null;
    });
  const storedSettings = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem("grok64-settings") || "null")?.state ?? null);
  const tomSettingsDrift = async () => {
    const stored = await storedSettings();
    return TOM_SETTINGS_KEYS.filter((k) => JSON.stringify(stored?.[k]) !== JSON.stringify(TOM_REUSED_PROFILE[k])).map(
      (k) => ({ key: k, want: TOM_REUSED_PROFILE[k], stored: stored?.[k] }),
    );
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
    note({ click: label });
  };
  const key = async (...keys) => sh("xdotool", ["key", "--delay", typeDelay, ...keys]);
  const type = async (text) => sh("xdotool", ["type", "--delay", typeDelay, "--", text]);
  /** Types one line on the C64 and presses Return. */
  const typeLine = async (line) => {
    await type(line);
    await key("Return");
    note({ typed: line });
  };
  /** NEW, then the program one line at a time, the way it is typed in by hand. */
  const typeProgram = async (lines) => {
    await typeLine("NEW");
    await sleep(800);
    for (const line of lines) {
      await typeLine(line);
      await sleep(400);
    }
  };
  const crt = () => page.locator(".g64-screen").first();
  /** Click the CRT, then type at once (the first key lands right after the click). */
  const clickCrtAndType = async (line) => {
    await click(crt(), "crt", { settle: 60 });
    await sleep(60);
    await typeLine(line);
  };
  const sheetOpen = () => page.locator(".g64-sheet").first().isVisible().catch(() => false);
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
  const openSettings = async () => {
    await click(await headerButton("Settings"), "Settings");
    await page.locator(".g64-sheet").first().waitFor({ state: "visible", timeout: 15_000 });
  };
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
  const waitReady = (ms) =>
    waitFor(async () => {
      const on = await page.evaluate(() => window.__g64?.running?.() && !window.__g64?.booting?.());
      return on && /READY\./.test(await screenText());
    }, ms, 500);
  const ensurePowered = async () => {
    if (await page.evaluate(() => window.__g64?.running?.())) return;
    await click(page.locator(".g64-power").first(), "Power on");
    await waitReady(180_000);
  };
  const powerCycle = async ({ offShot = "power-off.png", onShot = "power-on-ready.png" } = {}) => {
    const navBefore = navigations;
    if (await page.evaluate(() => window.__g64?.powered?.() || window.__g64?.booting?.())) {
      await click(await headerButton("Power off"), "Power off");
      await page.locator(".g64-splash").first().waitFor({ state: "visible", timeout: 30_000 });
      await sleep(800);
      await shot(offShot);
    }
    await click(page.locator(".g64-power").first(), "Power on");
    const ready = await waitReady(180_000);
    await sleep(1500);
    await shot(onShot);
    return { ready: Boolean(ready), reloads: navigations - navBefore };
  };

  /**
   * Picks `path` in Chrome's native (GTK) file dialog the way a user does: Ctrl+L, type the path,
   * click Open. Return in the GTK location field cancels Chrome's chooser, so it is not used.
   */
  const chooseFileInDialog = async (path, { shotPrefix = "file-dialog" } = {}) => {
    const win = await waitFor(async () => {
      const out = await sh("xdotool", ["search", "--onlyvisible", "--name", "^Open"], { allowFail: true });
      return out.trim().split("\n").filter(Boolean).pop() || null;
    }, 15_000, 400);
    if (!win) throw new Error("native file dialog did not open");
    await sh("xdotool", ["windowactivate", "--sync", win], { allowFail: true });
    await sh("xdotool", ["windowfocus", "--sync", win], { allowFail: true });
    await sleep(600);
    await shot(`${shotPrefix}.png`);
    await key("ctrl+l");
    await sleep(300);
    await sh("xdotool", ["type", "--delay", "25", "--", path]);
    await sleep(400);
    await shot(`${shotPrefix}-path.png`);
    const geom = await sh("xdotool", ["getwindowgeometry", win]);
    const m = /Position: (-?\d+),(-?\d+).*Geometry: (\d+)x(\d+)/s.exec(geom);
    if (!m) throw new Error(`file dialog geometry: ${geom}`);
    const [wx, wy, ww, wh] = m.slice(1).map(Number);
    await sh("xdotool", ["mousemove", "--sync", String(wx + ww - 50), String(wy + wh - 10)]);
    await sleep(300);
    await shot(`${shotPrefix}-open.png`);
    await sh("xdotool", ["click", "1"]);
    note({ chose: path });
    const closed = await waitFor(async () => {
      const out = await sh("xdotool", ["search", "--onlyvisible", "--name", "^Open"], { allowFail: true });
      return out.trim() ? null : true;
    }, 10_000, 300);
    if (!closed) throw new Error(`file dialog still open after choosing ${path}`);
  };

  /**
   * Makes the library hold exactly one row `file.name` with `file.sha1`: stale rows go through
   * Remove, the file comes in through Import and the native file dialog (Import plays it).
   */
  const ensureInLibrary = async (file, { shotPrefix = "import" } = {}) => {
    const rows = (await libraryRows()).filter((r) => r.name === file.name);
    const good = rows.filter((r) => r.sha1 === file.sha1);
    if (rows.length === 1 && good.length === 1) return { imported: false, rowSha1: good[0].sha1 };
    await openLibrary();
    for (let i = 0; i < rows.length; i++) {
      await click(page.getByRole("button", { name: `Remove ${file.name}`, exact: true }).first(), `Remove ${file.name}`);
      await sleep(600);
    }
    const left = (await libraryRows()).filter((r) => r.name === file.name).length;
    if (left) throw new Error(`${left} old ${file.name} rows still in the library`);
    await click(page.locator(".g64-actions button").filter({ hasText: /^Import$/ }).first(), "Import");
    await chooseFileInDialog(file.path, { shotPrefix: `${shotPrefix}-dialog` });
    const row = await waitFor(
      async () => (await libraryRows()).find((r) => r.name === file.name && r.sha1 === file.sha1),
      30_000,
      500,
    );
    if (!row) throw new Error(`import did not store ${file.name} with sha1 ${file.sha1}`);
    await waitReady(180_000);
    await sleep(1500);
    await shot(`${shotPrefix}-played.png`);
    return { imported: true, rowSha1: row.sha1 };
  };

  /**
   * Software → On this device → unit → Insert, as a user mounts a library disk on a running C64.
   * The screen must stay at READY with nothing typed (Grok64 never types LOAD on insert).
   */
  const insertFromLibrary = async (file, { unit = 8, shot: rowShot = "library-row.png", readyShot = "inserted-ready.png" } = {}) => {
    const out = {};
    const rowBefore = (await libraryRows()).find((r) => r.name === file.name);
    out.librarySha1AtInsert = rowBefore?.sha1 ?? null;
    out.exactMedia = file.sha1 ? rowBefore?.sha1 === file.sha1 : null;
    await openLibrary();
    const card = page.locator(".g64-card").filter({ has: page.getByText(file.name, { exact: true }) }).first();
    await card.waitFor({ state: "attached", timeout: 30_000 });
    await click(
      card.getByRole("group", { name: /IEC drive unit/i }).getByRole("button", { name: String(unit), exact: true }),
      `unit ${unit}`,
    );
    await sleep(300);
    const insert = page.getByRole("button", { name: `Insert ${file.name}`, exact: true });
    await insert.waitFor({ state: "attached", timeout: 30_000 });
    await reveal(insert, `Insert ${file.name}`);
    await shot(rowShot);
    const loadsBefore = ((await screenText()).match(/LOAD/g) ?? []).length;
    const toastRe = new RegExp(`^Inserted .+ on drive ${unit}$`);
    const insertToast = () =>
      page.evaluate(
        (src) =>
          Array.from(document.querySelectorAll("[data-sonner-toast]"), (t) => t.textContent?.trim() ?? "").find((t) =>
            new RegExp(src).test(t),
          ) ?? null,
        toastRe.source,
      );
    // A toast left from an earlier insert would vouch for a click that missed.
    if (!(await waitFor(async () => !(await insertToast()), 15_000, 300))) {
      throw new Error(`an earlier "Inserted … on drive ${unit}" toast is still showing`);
    }
    await click(insert, `Insert ${file.name}`);
    if (!(await waitFor(async () => !(await sheetOpen()), 15_000))) {
      throw new Error(`clicking Insert ${file.name} did not close the Software sheet`);
    }
    out.insertToast = await waitFor(insertToast, 60_000, 200);
    if (!out.insertToast) throw new Error(`no "Inserted … on drive ${unit}" toast after clicking Insert ${file.name}`);
    out.mountedAfterInsert = await page.evaluate(() => window.__g64?.media?.() ?? null);
    out.insertedExact = Boolean(
      out.mountedAfterInsert?.some((m) => m.name === file.name && (file.bytes == null || m.size === file.bytes)),
    );
    await waitReady(180_000);
    await sleep(4000);
    const afterInsert = await screenText();
    out.insertLeftReady = /READY\./.test(afterInsert) && (afterInsert.match(/LOAD/g) ?? []).length === loadsBefore;
    await shot(readyShot);
    return out;
  };

  const setJiffy = async (want, { shot: jiffyShot = "settings-jiffy.png" } = {}) => {
    await openSettings();
    const row = page.locator(".g64-row").filter({ hasText: "JiffyDOS (needs C64 + 1541 ROMs)" }).first();
    await row.waitFor({ state: "attached", timeout: 15_000 });
    const sw = row.locator('button[role="switch"]').first();
    await reveal(sw, "JiffyDOS switch");
    const before = (await sw.getAttribute("aria-checked")) === "true";
    if (before !== want) await click(sw, `JiffyDOS switch → ${want ? "on" : "off"}`);
    await sleep(400);
    const after = (await sw.getAttribute("aria-checked")) === "true";
    await shot(jiffyShot);
    await closeSheet();
    if (after !== want) throw new Error(`JiffyDOS switch stayed ${after ? "on" : "off"}`);
    return { before, after };
  };

  const openAbout = async ({ shot: aboutShot = "about.png" } = {}) => {
    await click(await headerButton("About"), "About");
    await sleep(1500);
    await shot(aboutShot);
    await key("Escape");
    await sleep(500);
  };

  /** The status line the error-channel program prints after RUN, e.g. " 23 READ ERROR 18  1". */
  const waitErrorChannel = async (ms = 30_000) => {
    const t0 = Date.now();
    let text = "";
    while (Date.now() - t0 < ms) {
      await sleep(700);
      text = await screenText();
      const lines = text.split("\n");
      const runAt = lines.findLastIndex((l) => /^\s*RUN\s*$/i.test(l));
      if (runAt < 0) continue;
      const after = lines.slice(runAt + 1).filter((l) => l.trim());
      if (!after.some((l) => /^\s*READY\.\s*$/.test(l))) continue;
      const m = after.map((l) => /^\s*(\d+)\s+(.+?)\s+(\d+)\s+(\d+)\s*$/.exec(l)).find(Boolean);
      return m
        ? { text: m[0].trim().replace(/\s+/g, " "), code: Number(m[1]), message: m[2], track: Number(m[3]), sector: Number(m[4]) }
        : { text: after.join(" | ").slice(0, 120), code: null };
    }
    return { text: text.split("\n").filter((l) => l.trim()).slice(-3).join(" | "), code: null, timeout: true };
  };
  /** Types the error-channel program for `unit`, runs it and reads the status line. */
  const readErrorChannel = async (unit = 8) => {
    await typeProgram(errorChannelProgram(unit));
    await typeLine("RUN");
    return waitErrorChannel();
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
    await xgrab(join(shotDir, "calibration-failed.png")).catch(() => {});
    throw new Error("calibration: no mousemove reached the page");
  };

  /**
   * Seeds Tom's settings on the profile's first run, opens the app, checks Tom's stored settings
   * are unchanged and measures the pointer offset. Throws on drift.
   */
  const start = async () => {
    const info = {};
    if (!profile.tomSettingsSeeded) {
      // Written while no app page is open: a running page persists its whole settings state on any store update.
      const seedUrl = new URL("grok64-gate-seed", cfg.base).href;
      await page.route(seedUrl, (r) =>
        r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>seed</title>" }),
      );
      await page.goto(seedUrl);
      await seedTomReusedProfile(page, { jiffyDos: false });
      await page.unroute(seedUrl);
      profile.tomSettingsSeeded = new Date().toISOString();
      saveProfileMeta(profile);
    }
    await page.goto(cfg.base, { waitUntil: "domcontentloaded" });
    await appReady();
    info.startup = {
      navigations,
      coreCacheAutoReload: await page.evaluate(() => sessionStorage.getItem("grok64.coreCacheAutoReload")),
    };
    info.storedSettings = await storedSettings();
    info.tomSettingsDrift = await tomSettingsDrift();
    if (info.tomSettingsDrift.length) {
      throw Object.assign(new Error(`stored settings drifted from Tom's: ${JSON.stringify(info.tomSettingsDrift)}`), {
        info,
      });
    }
    await page.bringToFront();
    off = await calibrate();
    info.calibration = off;
    return info;
  };

  return {
    cfg,
    page,
    context,
    errors,
    profile,
    navigations: () => navigations,
    runInfo: () => ({
      profile: { dir: cfg.profileDir, createdAt: profile.createdAt, copiedFrom: profile.copiedFrom, runs: profile.runs },
      chrome: cfg.chromeBin ?? "playwright-chromium",
      display: cfg.display,
      wm: cfg.wm || null,
      typeDelayMs: Number(typeDelay),
    }),
    setShotDir: (dir) => {
      shotDir = dir;
    },
    shotDir: () => shotDir,
    setTrace: (t) => {
      trace = t;
    },
    note,
    sh,
    xgrab,
    startRecording,
    shot,
    screenText,
    waitScreen,
    waitTypedLine,
    libraryRows,
    coreStatus,
    storedSettings,
    tomSettingsDrift,
    appReady,
    start,
    xmove,
    firstVisible,
    visibleBox,
    reveal,
    stableBox,
    click,
    key,
    type,
    typeLine,
    typeProgram,
    crt,
    clickCrtAndType,
    sheetOpen,
    closeSheet,
    headerButton,
    openSettings,
    openLibrary,
    waitReady,
    ensurePowered,
    powerCycle,
    chooseFileInDialog,
    ensureInLibrary,
    insertFromLibrary,
    setJiffy,
    openAbout,
    waitErrorChannel,
    readErrorChannel,
    close: () => context.close().catch(() => {}),
  };
}
