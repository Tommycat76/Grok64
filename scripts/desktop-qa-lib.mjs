/**
 * Shared desktop Playwright helpers (Chromium 1280×800).
 */

export async function waitForG64(page, ms = 12000) {
  for (let i = 0; i < ms / 200; i++) {
    if (await page.evaluate(() => typeof window.__g64?.power === "function")) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

export async function powerOnDesktop(page, base, { navigate = true } = {}) {
  if (navigate) await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForG64(page);
  const live = await page.evaluate(() => Boolean(window.__g64?.hasFs?.()));
  if (live) {
    for (let i = 0; i < 40; i++) {
      if (await page.evaluate(() => window.__g64?.hasFs?.())) return true;
      await page.waitForTimeout(300);
    }
    return true;
  }
  await page.locator(".g64-power").waitFor({ timeout: 30000 });
  const safeHasFs = async () => {
    try {
      return await page.evaluate(() => Boolean(window.__g64?.hasFs?.()));
    } catch {
      return false;
    }
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await page.evaluate(() => {
        document.querySelector(".g64-power")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        document.querySelector(".g64-splash")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    } catch {
      await waitForG64(page, 8000);
    }
    for (let i = 0; i < 50; i++) {
      if (await safeHasFs()) break;
      await page.waitForTimeout(300);
    }
    if (await safeHasFs()) break;
    await page.waitForTimeout(500);
  }
  for (let i = 0; i < 60; i++) {
    if (await safeHasFs()) break;
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(2500);
  return await page.evaluate(() => window.__g64?.hasFs?.());
}

export async function openSoftware(page) {
  await page.locator(".g64-software").click({ timeout: 15000 });
  await page.locator(".g64-catalog, .g64-sheet").first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
}

export async function catalogSearch(page, query) {
  const input = page.locator(".g64-search input").first();
  await input.waitFor({ timeout: 8000 });
  await input.fill(query);
  await page.locator(".g64-search button[type='submit']").click();
  await page
    .waitForFunction(
      () => {
        const root = document.querySelector(".g64-catalog");
        if (!root) return false;
        if (root.querySelector(".animate-spin")) return false;
        return true;
      },
      { timeout: 12000 },
    )
    .catch(() => null);
  await page.waitForTimeout(200);
}

export async function waitRunning(page, ms = 20000) {
  for (let i = 0; i < ms / 200; i++) {
    const on = await page.evaluate(() => window.__g64?.running?.() && !window.__g64?.booting?.());
    if (on) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

export async function canvasHasSignal(page) {
  return page.evaluate(async () => {
    const shot = await window.__g64?.shot?.();
    if (!shot?.b64 || shot.b64.length < 800) return false;
    const bin = atob(shot.b64.slice(0, 4000));
    let dark = 0;
    for (let i = 0; i < bin.length; i++) if (bin.charCodeAt(i) < 32) dark++;
    return dark < bin.length * 0.95;
  });
}

function decodePngStats(page, b64, src) {
  return page.evaluate(async ({ b64, src }) => {
    if (!b64 || b64.length < 800) return { ok: false, reason: "no-b64" };
    try {
      const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
      const bmp = await createImageBitmap(blob);
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext("2d");
      if (!ctx) return { ok: false, reason: "no-2d" };
      ctx.drawImage(bmp, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
      const pixels = width * height;
      let geosDesk = 0;
      let viceBlank = 0;
      let ink = 0;
      const buckets = new Set();
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        buckets.add(`${r >> 4},${g >> 4},${b >> 4}`);
        if (g > 110 && b > 140 && r < 150) geosDesk += 1;
        if (g > 85 && b > 85 && r > 85 && r < 210 && g < 210 && b < 210) geosDesk += 0.35;
        if (b > 170 && r < 90 && g < 130) viceBlank += 1;
        if (r + g + b < 80) ink += 1;
      }
      return {
        ok: true,
        w: width,
        h: height,
        buckets: buckets.size,
        geosDesk: geosDesk / pixels,
        viceBlank: viceBlank / pixels,
        ink: ink / pixels,
        src,
      };
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
  }, { b64, src });
}

function isBlankStats(stats) {
  return Boolean(stats && stats.buckets <= 3 && stats.ink > 0.92);
}

/** Decode __g64 shot PNG and sample pixels — catches blank VICE blue vs real GEOS/cart UI. */
export async function canvasPixelStats(page) {
  const shotWrap = await page.evaluate(async () => {
    const shot = await window.__g64?.shot?.();
    return shot?.b64 && shot.b64.length >= 1200 ? { b64: shot.b64, src: shot.src ?? "vice" } : null;
  });
  if (shotWrap) {
    const stats = await decodePngStats(page, shotWrap.b64, shotWrap.src);
    if (stats?.ok && !isBlankStats(stats)) return stats;
  }
  const canvas = page.locator("#grok64-player canvas:not(.g64-ios-present)").first();
  if (await canvas.count()) {
    const buf = await canvas.screenshot({ type: "png" });
    const b64 = buf.toString("base64");
    const stats = await decodePngStats(page, b64, "playwright");
    if (stats?.ok && !isBlankStats(stats)) return stats;
  }
  const screen = page.locator(".g64-screen").first();
  if (await screen.count()) {
    const buf = await screen.screenshot({ type: "png" });
    const stats = await decodePngStats(page, buf.toString("base64"), "screen");
    if (stats?.ok) return stats;
  }
  return { ok: false, reason: "no-shot" };
}

/** True when the CRT is still stock/JiffyDOS BASIC, not a GEOS/GUI bitmap. */
export function isStillBasicNotGeos(text) {
  if (!text) return false;
  if (/BOOTING GEOS/i.test(text)) return false;
  if (/\bREADY\b/i.test(text) && (/COMMODORE 64 BASIC/i.test(text) || /JIFFYDOS/i.test(text) || /C-64 BASIC V2/i.test(text))) {
    return true;
  }
  return /SAVING BOOT/i.test(text) && /READY\./i.test(text);
}

/** GUI64's desktop is a flat purple work area — VICE PNG dumps are often black. */
export async function canvasLooksLikeGui64(page) {
  const stats = await canvasPixelStats(page);
  if (!stats?.ok) return { pass: false, stats };
  const text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  const pass = !isStillBasicNotGeos(text) && stats.buckets >= 4 && stats.viceBlank < 0.9;
  return { pass, stats, textHead: text.slice(0, 100) };
}

export async function canvasLooksLikeGeosDesktop(page) {
  const stats = await canvasPixelStats(page);
  if (!stats?.ok) return { pass: false, stats };
  const text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  const pass =
    !isStillBasicNotGeos(text) &&
    stats.geosDesk >= 0.1 &&
    stats.viceBlank < 0.85 &&
    stats.ink < 0.995 &&
    (stats.buckets >= 8 || stats.geosDesk >= 0.14);
  return { pass, stats, textTail: text.slice(-120) };
}

export async function canvasLooksLikeCartMenu(page, { minBuckets = 40 } = {}) {
  const stats = await canvasPixelStats(page);
  if (!stats?.ok) return { pass: false, stats };
  const text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  const basicOnly = /^\s*READY\.?\s*$/m.test(text.trim()) && text.length < 80;
  const pass = !basicOnly && stats.buckets >= minBuckets && stats.ink >= 0.004 && stats.viceBlank < 0.9;
  return { pass, stats, textHead: text.slice(0, 100) };
}

/**
 * CRT shows Grok64/VICE floppy autostart (typed LOAD"*",8,1), not cart boot-sector IEC.
 * Super Snapshot v5 §11 reads track 1 sector 0 without this KERNAL sequence — see
 * docs/CART_BOOT_AUTOSTART.md.
 */
export function grok64FloppyAutostartPoison(text) {
  if (!text) return false;
  if (/LOAD"\*",8,1/i.test(text)) return true;
  if (/LOAD"\*"/i.test(text) && /SEARCHING FOR \*|FILE NOT FOUND/i.test(text)) return true;
  return false;
}

export function isBasicReadyScreen(text) {
  if (/TURBO|SNAPSHOT|REPLAY|ACTION|FINAL|FAST\s*LOAD|KCS|WARP|CARTRIDGE|EPYX/i.test(text)) return false;
  const compact = text.replace(/\s+/g, "").length;
  if (compact >= 280) return false;
  const ready = /\bREADY\b/i.test(text);
  if (!ready) return false;
  if (/COMMODORE 64 BASIC/i.test(text)) return true;
  // JiffyDOS KERNAL after CART OUT — still idle BASIC, not a freezer menu.
  return /JIFFY/i.test(text) && !/LOAD"\*"/i.test(text) && !/SEARCHING/i.test(text);
}

export async function noPowerSplash(page) {
  return (await page.locator(".g64-splash[data-on='true']").count()) === 0;
}

/** Tom's reused profile (auto machine/video/core/drive + REU 2M + SCPU prefs). */
export const TOM_REUSED_PROFILE = {
  machineId: "c64-auto",
  videoStandard: "auto",
  coreMode: "auto",
  driveMode: "auto",
  reuSize: "2048kB",
  mouseMode: true,
  scpuSimm: "16",
  scpuTurbo: true,
  iecMap: { 8: "1541", 9: "cmdhd", 10: "none", 11: "none" },
  iecDrive: "cmdhd",
  iecUnit: 9,
};

/** zustand persist entry of `useEmu` (src/lib/emu/store.ts `name` / `version`). */
const SETTINGS_KEY = "grok64-settings";
const SETTINGS_VERSION = 14;

export async function seedTomReusedProfile(page, overrides = {}) {
  const merged = { ...TOM_REUSED_PROFILE, ...overrides };
  return page.evaluate(
    ({ p, key, version }) => {
      try {
        sessionStorage.removeItem("grok64-post-cart-out");
      } catch {
        /* ignore */
      }
      const prev = JSON.parse(localStorage.getItem(key) || "null");
      const state = {
        ...(prev?.state ?? {}),
        machineId: p.machineId,
        videoStandard: p.videoStandard,
        coreMode: p.coreMode,
        driveMode: p.driveMode,
        reuSize: p.reuSize,
        jiffyDos: !!p.jiffyDos,
        mouseMode: !!p.mouseMode,
        scpuSimm: p.scpuSimm,
        scpuTurbo: !!p.scpuTurbo,
        iecMap: p.iecMap,
        iecDrive: p.iecDrive,
        iecUnit: p.iecUnit,
        joyPort: 2,
        wasdIsJoy: false,
      };
      localStorage.setItem(key, JSON.stringify({ state, version: prev?.version ?? version }));
      return true;
    },
    { p: merged, key: SETTINGS_KEY, version: SETTINGS_VERSION },
  );
}

/** Throws unless the running app took the seeded settings. */
export async function assertSessionFlags(page, want) {
  const flags = await page.evaluate(() => window.__g64?.sessionFlags?.() ?? null);
  const bad = Object.entries(want).filter(([k, v]) => flags?.[k] !== v);
  if (!flags || bad.length) throw new Error(`settings not applied: want ${JSON.stringify(want)}, got ${JSON.stringify(flags)}`);
  return flags;
}

export function patchLocalStorage(page, combo) {
  return page.evaluate(({ combo, key: settingsKey }) => {
    try {
      sessionStorage.removeItem("grok64-post-cart-out");
    } catch {
      /* private mode */
    }
    const key =
      localStorage.getItem(settingsKey) != null
        ? settingsKey
        : Object.keys(localStorage).find((k) => k.includes("grok64"));
    if (!key) return false;
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data.state) return false;
    data.state.powered = false;
    data.state.running = false;
    data.state.booting = false;
    if (combo.video != null) data.state.videoStandard = combo.video;
    if (combo.driveMode) data.state.driveMode = combo.driveMode;
    if (combo.coreMode) data.state.coreMode = combo.coreMode;
    if (combo.machineId) data.state.machineId = combo.machineId;
    if (combo.scpuSimm) data.state.scpuSimm = combo.scpuSimm;
    if (combo.scpuTurbo != null) data.state.scpuTurbo = !!combo.scpuTurbo;
    data.state.sidModel = combo.sid;
    data.state.sid2Address = combo.sid2 ?? "disabled";
    data.state.sid3Address = "disabled";
    data.state.reuSize = combo.reu ?? "none";
    data.state.jiffyDos = !!combo.jiffy;
    if (combo.coreMode) data.state.coreMode = combo.coreMode;
    if (combo.machineId) data.state.machineId = combo.machineId;
    data.state.mouseMode = !!combo.mouse;
    data.state.joyPort = combo.joy ?? 2;
    if (combo.iecMap) {
      data.state.iecMap = combo.iecMap;
      if (combo.iecDrive) data.state.iecDrive = combo.iecDrive;
      if (combo.iecUnit) data.state.iecUnit = combo.iecUnit;
    } else if (combo.drive === "sd2iec") {
      data.state.iecMap = { 8: "sd2iec", 9: "none", 10: "none", 11: "none" };
    } else if (combo.drive === "cmd-layout") {
      data.state.iecMap = { 8: "1541", 9: "cmdhd", 10: "none", 11: "none" };
      data.state.iecDrive = "cmdhd";
      data.state.iecUnit = 9;
    } else {
      data.state.iecMap = {
        8: combo.drive === "1581" ? "1581" : "1541",
        9: "none",
        10: "none",
        11: "none",
      };
    }
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  }, { combo, key: SETTINGS_KEY });
}

const C64_EXTRA = {
  '"': { code: "Digit2", shift: true },
  "*": { code: "BracketRight", shift: false },
  ",": { code: "Comma", shift: false },
  $: { code: "Digit4", shift: true },
  ":": { code: "Semicolon", shift: false },
  ";": { code: "Quote", shift: false },
  "+": { code: "Minus", shift: false },
  "-": { code: "Equal", shift: false },
  "=": { code: "IntlBackslash", shift: false },
  "/": { code: "Slash", shift: false },
  "(": { code: "Digit9", shift: true },
  ")": { code: "Digit0", shift: true },
};

/** C64 keystrokes for Playwright (trusted keys → Emscripten !parent). */
export function c64Keystrokes(text) {
  const out = [];
  for (const ch of text) {
    if (/^[A-Za-z]$/.test(ch)) {
      const up = ch.toUpperCase();
      out.push({ code: `Key${up}`, shift: false });
      continue;
    }
    if (/^[0-9]$/.test(ch)) {
      out.push({ code: `Digit${ch}`, shift: false });
      continue;
    }
    const extra = C64_EXTRA[ch];
    if (extra) out.push(extra);
  }
  return out;
}

async function pressC64Stroke(page, stroke, delayMs) {
  if (stroke.shift) await page.keyboard.down("Shift");
  await page.keyboard.press(stroke.code, { delay: delayMs });
  if (stroke.shift) await page.keyboard.up("Shift");
}

/** Playwright trusted keyboard on the CRT canvas (not typeC64 / feedBasic). */
export async function typeC64RealKeyboard(page, text, { keyDelayMs = 65, lineEndMs = 700 } = {}) {
  await page.evaluate(() => window.__g64?.kbdReleaseAll?.());
  await page
    .locator("#grok64-player canvas, .g64-crt canvas")
    .first()
    .click({ timeout: 10_000, force: true })
    .catch(() => {});
  await page.waitForTimeout(300);
  for (const ch of text) {
    for (const stroke of c64Keystrokes(ch)) {
      await pressC64Stroke(page, stroke, keyDelayMs);
      await page.waitForTimeout(stroke.shift ? 50 : 25);
    }
    const settle = ch === '"' || ch === "$" || ch === "," ? 130 : 55;
    await page.waitForTimeout(settle);
  }
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter", { delay: keyDelayMs });
  await page.waitForTimeout(lineEndMs);
}

/** Type a BASIC line via VICE kbdbuf / KERNAL queue (real LOAD path). */
/** Real 1541 @ 1× — for load timing (no warp / virtual traps). */
export async function ensureReal1541Timing(page) {
  return page.evaluate(async () => {
    window.__g64?.setWarp?.(false);
    window.__g64?.setIecSlot?.(8, "1541");
    const timing = await window.__g64?.prepareReal1541Timing?.();
    const opts = window.__g64?.opts?.() ?? {};
    const flags = window.__g64?.sessionFlags?.() ?? {};
    return {
      timing,
      warped: flags.warped,
      opts: {
        tde: opts.vice_drive_true_emulation,
        traps: opts.vice_virtual_device_traps,
        autostartWarp: opts.vice_autostart_warp,
        drive8: opts.vice_drive8_type,
      },
    };
  });
}

/** GEOS insert/list evidence when CRT screenText omits ASCII "GEOS" (PETSCII). */
/** Manifest + glue aligned with shipped IEC core (baseline gate). */
export function baselineCoreDiagOk(diag) {
  if (!diag) return false;
  return (
    diag.coreBuildMatches === true &&
    diag.loadedGlueHasDiskExports === true &&
    diag.diskExportsPresent === true
  );
}

/** True 1541 TDE (not vdrive traps) when WASM probes exist. */
export function baselineDriveLiveOk(live) {
  if (!live) return true;
  const hasTdeProbe = live.wasmVirtualDevice != null || live.wasmUnitTrueEmulation != null;
  if (!hasTdeProbe) return true;
  const tde =
    live.wasmIecDevice === 0 && live.wasmVirtualDevice === 0 && live.wasmUnitTrueEmulation === 1;
  const cpu =
    live.wasmDriveUnitEnabled === 1 &&
    live.wasmRomLoaded === 1 &&
    live.wasmDriveUnitType !== 1542;
  const vdriveTrap =
    live.wasmVdriveErrorIsVirtual === 1 ||
    /VIRTUAL\s+DRIVE/i.test(live.wasmVdriveErrorChannel ?? live.wasmErrorChannel ?? "");
  const iecText = String(live.iecErrorChannel ?? "").trim();
  const iecProbeUsable = /CBM\s+DOS|VIRTUAL\s+DRIVE/i.test(iecText);
  const iecOk = iecProbeUsable
    ? /CBM\s+DOS/i.test(iecText) && !/VIRTUAL\s+DRIVE/i.test(iecText)
    : live.wasmVdriveErrorIsVirtual !== 1 && !vdriveTrap;
  const tdeBytes = live.wasmTdeImageBytes;
  const tdeBus =
    tdeBytes == null
      ? true
      : tdeBytes >= 174848 && live.wasmGcrLoaded === 1 && live.wasmVdriveImageSame === 1;
  return tde && cpu && iecOk && tdeBus;
}

/** Merge attachDiskDiag live probe with C64-side OPEN 15 IEC read. */
export async function liveWithIecErrorProbe(page, live = null) {
  const wasmLive =
    live ??
    (await page.evaluate(() => {
      const g = window.__g64;
      const liveFn = g?.viceDriveLive;
      return typeof liveFn === "function" ? liveFn() : null;
    }));
  const ch = String(wasmLive?.wasmErrorChannel ?? "").trim();
  const isVirtual =
    wasmLive?.wasmVdriveErrorIsVirtual === 1 || /VIRTUAL\s+DRIVE/i.test(ch);
  return {
    ...wasmLive,
    iecErrorChannel: ch,
    iecProbeOk: ch.length > 0 && !isVirtual,
    iecIsCbmDos: /CBM\s+DOS/i.test(ch) && !isVirtual,
  };
}

/** GEOS 2.0 directory must show a GEOS-named file on screen (not empty BLOCKS FREE). */
export function geosDirectoryOnScreen(screen = "") {
  if (!screen?.trim()) return false;
  if (/FILE NOT FOUND|DEVICE NOT PRESENT|\?FILE/i.test(screen)) return false;
  return (
    /"GEOS\b/i.test(screen) ||
    /\bGEOS\s+SEQ\b/i.test(screen) ||
    /\bGEOS\s+PRG\b/i.test(screen) ||
    /GEOS\s{2,}"/i.test(screen)
  );
}

export function geosFloppyEvidence({ screen = "", session = null, wasmWorkDisk = null, viceAttachedImage = null }) {
  const wasmOk = wasmWorkDisk?.length
    ? Boolean(
        wasmWorkDisk.some((r) => r.matchesSession && (r.wasmFsStat ?? 0) > 0 && (r.moduleFsBytes ?? 0) > 0),
      )
    : Boolean(viceAttachedImage?.trim());
  const iecFail = /FILE NOT FOUND|DEVICE NOT PRESENT|\?FILE/i.test(screen);
  const dirHex = session?.dir18s1Hex ?? "";
  const label = session?.diskLabel ?? "";
  const onScreen = geosDirectoryOnScreen(screen);
  const catalogOk = onScreen;
  const attachOk = Boolean(viceAttachedImage?.trim());
  return {
    wasmOk,
    iecFail,
    catalogOk,
    onScreen,
    attachOk,
    ok: wasmOk && attachOk && !iecFail && onScreen,
  };
}

/** Screen text below the last line that holds `command` (spaces ignored); null when it is gone. */
export function screenTextAfterCommand(text, command) {
  const want = command.replace(/\s+/g, "").toUpperCase();
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].replace(/\s+/g, "").toUpperCase().includes(want)) return lines.slice(i + 1).join("\n");
  }
  return null;
}

const BASIC_LOAD_ERROR = /FILE NOT FOUND|DEVICE NOT PRESENT|\?\w+ +ERROR/i;

/** Wait for a typed BASIC command to come back with READY. or an error. */
export async function waitBasicCommand(page, command, maxMs) {
  const t0 = Date.now();
  let after = null;
  while (Date.now() - t0 < maxMs) {
    await page.waitForTimeout(1000);
    after = screenTextAfterCommand(await page.evaluate(() => window.__g64?.screenText?.() ?? ""), command);
    if (after == null) continue;
    if (BASIC_LOAD_ERROR.test(after)) return { error: true, ms: Date.now() - t0, after: after.trim().slice(0, 160) };
    if (/READY\./.test(after)) return { error: false, ms: Date.now() - t0 };
  }
  return { error: true, timeout: true, ms: Date.now() - t0, after: after?.trim().slice(0, 160) ?? null };
}

/**
 * After LOAD"GEOS",8,1 was typed: BSW boot disks return to READY. and need RUN (typed via
 * `typeRun`); boot files that load into the stack page start GEOS by themselves. Resolves
 * once the deskTop is on screen, the load failed, or time ran out. The menu bar is up before
 * the deskTop has read the boot disk, so a found deskTop gets `settleMs` to fill its window.
 * A boot that resets the C64 (cold-start banner back, typed command gone) resolves at once with
 * `reset: true`; `bootingGeos` tells whether "BOOTING GEOS" was on screen before.
 */
export async function waitGeosBoot(
  page,
  { command = 'LOAD"GEOS",8,1', typeRun, loadMs = 180_000, deskTopMs = 240_000, settleMs = 20_000, onTick } = {},
) {
  const t0 = Date.now();
  const out = { load: null, run: "not-needed", deskTop: null, bootingGeos: false };
  let deskAt = 0;
  let after = null;
  let desk = null;
  const screen = async () => {
    const text = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
    if (/BOOTING GEOS/i.test(text)) out.bootingGeos = true;
    return text;
  };
  const resetTo = (text, last) => coldStartScreen(text) && screenTextAfterCommand(text, last) == null;
  while (Date.now() - t0 < loadMs) {
    await page.waitForTimeout(1000);
    const text = await screen();
    after = screenTextAfterCommand(text, command);
    if (resetTo(text, command)) {
      out.load = { error: false, ms: Date.now() - t0, ready: false, reset: true };
      out.deskTop = { pass: false, reset: true, ms: Date.now() - t0 };
      return out;
    }
    if (after != null && BASIC_LOAD_ERROR.test(after)) {
      out.load = { error: true, ms: Date.now() - t0, after: after.trim().slice(0, 160) };
      return out;
    }
    if (after != null && /READY\./.test(after)) {
      out.load = { error: false, ms: Date.now() - t0, ready: true };
      break;
    }
    if (Date.now() - deskAt >= 3000) {
      deskAt = Date.now();
      desk = await canvasLooksLikeGeosDesktop(page);
      if (desk.pass) {
        out.load = { error: false, ms: Date.now() - t0, ready: false, autostart: true };
        out.deskTop = { pass: true, ms: Date.now() - t0, stats: desk.stats };
        await page.waitForTimeout(settleMs);
        return out;
      }
    }
    await onTick?.(Date.now() - t0);
  }
  if (!out.load) {
    if (after != null) {
      out.load = { error: true, timeout: true, ms: Date.now() - t0, after: after.trim().slice(0, 160) };
      return out;
    }
    out.load = { error: false, ms: Date.now() - t0, ready: false, leftBasic: true };
  }
  if (out.load.ready) {
    await typeRun();
    out.run = "typed";
  }
  const t1 = Date.now();
  while (Date.now() - t1 < deskTopMs) {
    await page.waitForTimeout(3000);
    if (resetTo(await screen(), out.run === "typed" ? "RUN" : command)) {
      out.deskTop = { pass: false, reset: true, ms: Date.now() - t0 };
      return out;
    }
    desk = await canvasLooksLikeGeosDesktop(page);
    if (desk.pass) break;
    await onTick?.(Date.now() - t0);
  }
  out.deskTop = { pass: Boolean(desk?.pass), ms: Date.now() - t0, stats: desk?.stats, textTail: desk?.textTail };
  if (desk?.pass) await page.waitForTimeout(settleMs);
  return out;
}

/** Power-on screen of BASIC V2 (stock or JiffyDOS KERNAL) with nothing typed below READY. */
function coldStartScreen(text) {
  return /BASIC V2/i.test(text) && /BYTES FREE/i.test(text) && /READY\./.test(text) && text.replace(/\s+/g, "").length < 220;
}

/** Wait for LOAD"$" to finish (SEARCHING/LOADING cleared or IEC error). */
export async function waitForDollarLoad(page, { maxMs = 45_000 } = {}) {
  const t0 = Date.now();
  let last = "";
  while (Date.now() - t0 < maxMs) {
    await page.waitForTimeout(1000);
    last = await page.evaluate(() => window.__g64?.screenText?.() || "");
    if (/FILE NOT FOUND|DEVICE NOT PRESENT/i.test(last)) return { done: true, text: last, error: true };
    if (/SEARCHING FOR|LOADING/i.test(last)) continue;
    if (/BLOCKS FREE/i.test(last) || /"[\w]/i.test(last)) return { done: true, text: last, error: false };
    if (/READY/i.test(last) && !/LOAD\s*"\$"/i.test(last)) return { done: true, text: last, error: false };
  }
  return { done: false, text: last, error: false };
}

/** Type on the C64 canvas one key at a time (no kbdbuf / feedBasic). */
export async function typeC64Screen(page, text, { keyDelayMs = 85, lineEndMs = 600 } = {}) {
  await page
    .locator("#grok64-player canvas, .g64-crt canvas")
    .first()
    .click({ timeout: 10_000, force: true })
    .catch(() => {});
  for (const ch of text) {
    await page.evaluate(
      async ({ c, delay }) => {
        await window.__g64?.typeC64?.(c, { delayMs: delay });
      },
      { c: ch, delay: keyDelayMs },
    );
    await page.waitForTimeout(30);
  }
  await page.evaluate(async (delay) => {
    await window.__g64?.typeC64?.("\n", { delayMs: delay });
  }, keyDelayMs);
  await page.waitForTimeout(lineEndMs);
}

export async function typeBasic(page, text, { afterMs = 12_000, listAfterDollar = null } = {}) {
  const wantList = listAfterDollar ?? /LOAD\s*"\$"/i.test(text);
  const ok = await page.evaluate(async (line) => Boolean(await window.__g64?.feedBasic?.(line)), text);
  if (!ok) throw new Error("feedBasic failed");
  if (wantList) {
    await waitForDollarLoad(page, { maxMs: 45_000 });
    const listed = await page.evaluate(async () => Boolean(await window.__g64?.feedBasic?.("LIST")));
    if (!listed) throw new Error("feedBasic LIST failed");
    await page.waitForTimeout(afterMs);
  } else {
    await page.waitForTimeout(afterMs);
  }
}

export async function matrixColdBoot(page, base, combo) {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await waitForG64(page);
  await patchLocalStorage(page, combo);
  await page.reload({ waitUntil: "domcontentloaded" });
  const fs = await powerOnDesktop(page, base, { navigate: false });
  const text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  const ok = /READY/i.test(text) || fs;
  return { ok, head: text.slice(0, 60) || (fs ? "fs-ok" : "no-fs") };
}
