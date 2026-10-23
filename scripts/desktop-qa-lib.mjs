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

export async function noPowerSplash(page) {
  return (await page.locator(".g64-splash[data-on='true']").count()) === 0;
}

export function patchLocalStorage(page, combo) {
  return page.evaluate((combo) => {
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
    data.state.mouseMode = !!combo.mouse;
    data.state.joyPort = combo.joy ?? 2;
    if (combo.drive === "sd2iec") {
      data.state.iecMap = { 8: "sd2iec", 9: "none", 10: "none", 11: "none" };
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
