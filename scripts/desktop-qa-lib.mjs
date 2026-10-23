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
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.evaluate(() => {
      document.querySelector(".g64-power")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      document.querySelector(".g64-splash")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    for (let i = 0; i < 50; i++) {
      if (await page.evaluate(() => window.__g64?.hasFs?.())) break;
      await page.waitForTimeout(300);
    }
    if (await page.evaluate(() => window.__g64?.hasFs?.())) break;
    await page.waitForTimeout(500);
  }
  for (let i = 0; i < 60; i++) {
    const fs = await page.evaluate(() => window.__g64?.hasFs?.());
    if (fs) break;
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

/** Decode __g64 shot PNG and sample pixels — catches blank VICE blue vs real GEOS/cart UI. */
export async function canvasPixelStats(page) {
  const shotWrap = await page.evaluate(async () => {
    const shot = await window.__g64?.shot?.();
    return shot?.b64 && shot.b64.length >= 1200 ? { b64: shot.b64, src: shot.src ?? "vice" } : null;
  });
  if (shotWrap) {
    const stats = await decodePngStats(page, shotWrap.b64, shotWrap.src);
    if (stats?.ok) return stats;
  }
  const canvas = page.locator("#grok64-player canvas:not(.g64-ios-present)").first();
  if (await canvas.count()) {
    const buf = await canvas.screenshot({ type: "png" });
    const b64 = buf.toString("base64");
    const stats = await decodePngStats(page, b64, "playwright");
    if (stats?.ok) return stats;
  }
  return { ok: false, reason: "no-shot" };
}

export async function canvasLooksLikeGeosDesktop(page) {
  const stats = await canvasPixelStats(page);
  if (!stats?.ok) return { pass: false, stats };
  const text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  const basicReady =
    /COMMODORE 64 BASIC/i.test(text) && /\bREADY\b/i.test(text) && text.replace(/\s+/g, "").length < 220;
  const pass =
    !basicReady &&
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

export function patchLocalStorage(page, combo) {
  return page.evaluate((combo) => {
    try {
      sessionStorage.removeItem("grok64-post-cart-out");
    } catch {
      /* private mode */
    }
    const keys = Object.keys(localStorage).filter((k) => k.includes("grok64"));
    if (!keys.length) return false;
    const raw = localStorage.getItem(keys[0]);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data.state) return false;
    data.state.powered = false;
    data.state.running = false;
    data.state.booting = false;
    data.state.videoStandard = combo.video;
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
    localStorage.setItem(keys[0], JSON.stringify(data));
    return true;
  }, combo);
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

export async function typeBasic(page, text, { afterMs = 12_000, listAfterDollar = null } = {}) {
  const wantList = listAfterDollar ?? /LOAD\s*"\$"/i.test(text);
  const ok = await page.evaluate(async (line) => {
    window.__ejs?.Module?._grok64_sd2iec_attach?.(8);
    return Boolean(await window.__g64?.feedBasic?.(line));
  }, text);
  if (!ok) throw new Error("feedBasic failed");
  await page.waitForTimeout(wantList ? 18_000 : afterMs);
  if (wantList) {
    const listed = await page.evaluate(async () => {
      window.__ejs?.Module?._grok64_sd2iec_attach?.(8);
      return Boolean(await window.__g64?.feedBasic?.("LIST"));
    });
    if (!listed) throw new Error("feedBasic LIST failed");
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
