#!/usr/bin/env node
/**
 * Real-UI hand check for the three input bugs, then GUI64 1351.
 *
 * Official GEOS Boot Disk: Import / Insert (stay at READY), type LOAD"BOOT",8,1,
 * deskTop, JOYSTICK then COMM 1351(a). Keyboard joystick default-off, on-screen
 * stick, canvas drag + trackpad + L click. JiffyDOS off and on.
 * GUI64 [NTSC].crt and [PAL].crt: 1351 move/click, WASD, stick.
 *
 *   GROK64_HAND_RECORD=0 GROK64_FIX_MEDIA=/tmp/g64media/g64media \
 *     node scripts/desktop-input-1351-gui64-hand.mjs
 *
 * Never copies the private media into the workspace.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  canvasLooksLikeGeosDesktop,
  canvasLooksLikeGui64,
  isStillBasicNotGeos,
  seedTomReusedProfile,
  waitGeosBoot,
} from "./desktop-qa-lib.mjs";
import { handConfig, openHand, sleep, waitFor, withHandDisplay } from "./desktop-hand-lib.mjs";

const cwd = process.cwd();
const mediaRoot = resolve(process.env.GROK64_FIX_MEDIA || "/tmp/g64media/g64media");
const files = {
  geos: join(mediaRoot, "GEOS Boot Disk.d64"),
  ntsc: join(mediaRoot, "GUI64 [NTSC].crt"),
  pal: join(mediaRoot, "GUI64 [PAL].crt"),
  jiffyC64: join(mediaRoot, "roms", "JiffyDOS_C64_6.01.bin"),
  jiffy1541: join(mediaRoot, "roms", "JiffyDOS_1541-II_6.00.bin"),
};
const shotRoot = join(cwd, "screenshots", "input-1351-gui64-hand");
const outDir = join(cwd, "artifacts", "input-1351-gui64-hand");
const deskTopMs = Number(process.env.GROK64_HAND_DESKTOP_MS || "240000");
const modes = (process.env.GROK64_HAND_JIFFY || "off,on").split(",").map((s) => s.trim() === "on");
const wantGui64 = (process.env.GROK64_HAND_GUI64 || "on") !== "off";
mkdirSync(shotRoot, { recursive: true });
mkdirSync(join(shotRoot, "boot"), { recursive: true });
mkdirSync(outDir, { recursive: true });

function sha1Of(path) {
  return createHash("sha1").update(readFileSync(path)).digest("hex");
}
function media(path) {
  return { path, name: basename(path), sha1: sha1Of(path), bytes: readFileSync(path).byteLength };
}

function writeRun(run) {
  writeFileSync(join(outDir, "results.json"), JSON.stringify(run, null, 2));
}

async function decodeShot(page, b64) {
  if (!b64 || b64.length < 800) return null;
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    return { data: Array.from(data), width, height };
  }, b64);
}

async function vicePng(page) {
  return page.evaluate(async () => {
    const shot = await window.__g64?.shot?.();
    return shot?.b64 && shot.b64.length >= 1200 ? shot.b64 : null;
  });
}

function isBlankImg(img) {
  if (!img) return true;
  let ink = 0;
  const buckets = new Set();
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i];
    const g = img.data[i + 1];
    const b = img.data[i + 2];
    buckets.add(`${r >> 4},${g >> 4},${b >> 4}`);
    if (r + g + b < 80) ink++;
  }
  return buckets.size <= 3 && ink / (img.data.length / 4) > 0.92;
}

function inkCentroid(img, { skipTop = 36 } = {}) {
  if (!img) return null;
  const { data, width, height } = img;
  let sx = 0;
  let sy = 0;
  let n = 0;
  const y0 = Math.min(height, skipTop);
  for (let y = y0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i] + data[i + 1] + data[i + 2] < 90) {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  if (n < 8) return null;
  return { x: sx / n, y: sy / n, n };
}

function contrastCentroid(img, { skipTop = 8, skipBottom = 0.18 } = {}) {
  if (!img) return null;
  const { data, width, height } = img;
  const y0 = Math.min(height, skipTop);
  const y1 = Math.max(y0 + 1, Math.floor(height * (1 - skipBottom)));
  const counts = new Map();
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const key = `${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  let mode = null;
  let modeN = 0;
  for (const [key, n] of counts) {
    if (n > modeN) {
      mode = key;
      modeN = n;
    }
  }
  if (!mode) return null;
  const [mr, mg, mb] = mode.split(",").map((s) => (Number(s) << 4) + 8);
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const d = Math.abs(data[i] - mr) + Math.abs(data[i + 1] - mg) + Math.abs(data[i + 2] - mb);
      if (d > 80) {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  if (n < 4) return null;
  return { x: sx / n, y: sy / n, n };
}

function frameDiff(a, b, { skipTop = 36, rect = null } = {}) {
  if (!a || !b || a.width !== b.width || a.height !== b.height) return { changed: 0 };
  let changed = 0;
  let sx = 0;
  let sy = 0;
  const x0 = rect ? Math.max(0, Math.floor(rect.x)) : 0;
  const x1 = rect ? Math.min(a.width, Math.ceil(rect.x + rect.w)) : a.width;
  const y0 = rect ? Math.max(0, Math.floor(rect.y)) : Math.min(a.height, skipTop);
  const y1 = rect ? Math.min(a.height, Math.ceil(rect.y + rect.h)) : a.height;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * a.width + x) * 4;
      const dr = Math.abs(a.data[i] - b.data[i]);
      const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
      const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
      if (dr + dg + db > 40) {
        changed++;
        sx += x;
        sy += y;
      }
    }
  }
  return { changed, cx: changed ? sx / changed : 0, cy: changed ? sy / changed : 0, pixels: a.width * a.height };
}

async function screenPng(page) {
  const loc = page.locator(".g64-screen").first();
  const buf = await loc.screenshot({ type: "png" });
  return buf.toString("base64");
}

async function snapshot(page) {
  let b64 = await vicePng(page);
  let img = await decodeShot(page, b64);
  let src = "vice";
  if (isBlankImg(img)) {
    b64 = await screenPng(page);
    img = await decodeShot(page, b64);
    src = "screen";
  }
  return { b64, img, src, ink: contrastCentroid(img) || inkCentroid(img) };
}

function movedEnough(before, after, { minChanged = 40, minInk = 2.5 } = {}) {
  const diff = frameDiff(before.img, after.img);
  const dx = before.ink && after.ink ? after.ink.x - before.ink.x : 0;
  const dy = before.ink && after.ink ? after.ink.y - before.ink.y : 0;
  const inkDist = Math.hypot(dx, dy);
  return {
    pass: diff.changed >= minChanged || inkDist >= minInk,
    changed: diff.changed,
    inkDist,
    dx,
    dy,
    inkBefore: before.ink,
    inkAfter: after.ink,
  };
}

function contentRect(img) {
  if (!img) return null;
  const { data, width, height } = img;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i] + data[i + 1] + data[i + 2] > 48) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        n++;
      }
    }
  }
  if (n < 80) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, n };
}

function notepadRect(img) {
  if (!img) return contentRect(img);
  const { data, width, height } = img;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > 210 && g > 210 && b > 210 && Math.abs(r - g) < 16 && Math.abs(g - b) < 16) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        n++;
      }
    }
  }
  if (n < 200) return contentRect(img);
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, n };
}

function geosMap(img, gx, gy) {
  const c = contentRect(img);
  if (!c) return null;
  return { x: c.x + (gx / 320) * c.w, y: c.y + (gy / 200) * c.h, content: c };
}

function pageGadgetPos(img) {
  // Official deskTop: the notepad title-bar "−" box is GEOS (240–255, 16–27), not the clock.
  return geosMap(img, 248, 22);
}

/** Locate the title-bar minus from pixels; fall back to the known GEOS slot. */
function findPageGadget(img) {
  const c = contentRect(img);
  if (!c) return pageGadgetPos(img);
  const { data, width } = img;
  const at = (gx, gy) => {
    const x = Math.round(c.x + (gx / 320) * c.w);
    const y = Math.round(c.y + (gy / 200) * c.h);
    const i = (y * width + x) * 4;
    return data[i] + data[i + 1] + data[i + 2];
  };
  let run = null;
  for (let gx = 220; gx <= 262; gx++) {
    const mid = (at(gx, 21) + at(gx, 22) + at(gx, 23)) / 3;
    const above = (at(gx, 18) + at(gx, 19)) / 2;
    const below = (at(gx, 25) + at(gx, 26)) / 2;
    if (mid < 280 && above > 360 && below > 360) {
      if (!run) run = { x0: gx, x1: gx };
      else run.x1 = gx;
    }
  }
  if (run && run.x1 - run.x0 >= 2) {
    const gx = (run.x0 + run.x1) / 2;
    return { x: c.x + (gx / 320) * c.w, y: c.y + (22 / 200) * c.h, content: c, gx };
  }
  return pageGadgetPos(img);
}

function notepadBodyRect(img) {
  const c = contentRect(img);
  if (!c) return null;
  return {
    x: Math.round(c.x + (16 / 320) * c.w),
    y: Math.round(c.y + (42 / 200) * c.h),
    w: Math.round((228 / 320) * c.w),
    h: Math.round((96 / 200) * c.h),
  };
}

/** The page *menu* opens append/delete — a new inner window frame, not page 2. */
function looksLikeDialog(before, after) {
  if (!before?.img || !after?.img) return false;
  const prior = new Set(longHorizLines(before.img, 28, 136).map((l) => l.gy));
  const added = longHorizLines(after.img, 28, 136).filter((l) => !prior.has(l.gy) && l.x >= 48 && l.x <= 96 && l.len >= 150);
  return added.length >= 2;
}

function longHorizLines(img, y0, y1, { minLen = 70 } = {}) {
  const c = contentRect(img);
  if (!c) return [];
  const { data, width } = img;
  const lines = [];
  for (let gy = y0; gy < y1; gy++) {
    const y = Math.round(c.y + (gy / 200) * c.h);
    let run = 0;
    let runX = 0;
    let best = 0;
    let bestX = 0;
    for (let gx = 0; gx < 320; gx++) {
      const x = Math.round(c.x + (gx / 320) * c.w);
      const i = (y * width + x) * 4;
      const dark = data[i] + data[i + 1] + data[i + 2] < 280;
      if (dark) {
        if (!run) runX = gx;
        run += 1;
        if (run > best) {
          best = run;
          bestX = runX;
        }
      } else run = 0;
    }
    if (best >= minLen) lines.push({ gy, x: bestX, len: best });
  }
  return lines;
}

/** Official boot disk: COMM 1351(a) is file 14 → notepad page 2, row 1 col 2. */
function comm1351Pos(img) {
  return geosMap(img, 152, 118);
}

/** The "1" under the icons — this flips file pages. The title-bar "−" is close. */
function pageNumberPos(img) {
  return geosMap(img, 138, 124);
}

function inPageNumberBox(g) {
  return Boolean(g && g.x >= 128 && g.x <= 152 && g.y >= 116 && g.y <= 132);
}

function looksLikeCenteredDialog(before, after) {
  if (!before?.img || !after?.img) return false;
  const c = contentRect(after.img);
  if (!c) return false;
  const diff = frameDiff(before.img, after.img, {
    rect: { x: c.x + c.w * 0.12, y: c.y + c.h * 0.16, w: c.w * 0.76, h: c.h * 0.6 },
    skipTop: 0,
  });
  return diff.changed >= 350;
}

/** Official Select Input Device: JOYSTICK highlight bar, empty mid, OK at bottom-right. */
function looksLikeSelectInput(img) {
  const c = contentRect(img);
  if (!c) return false;
  const { data, width, height } = img;
  const sample = (gx, gy) => {
    const x = Math.round(c.x + (gx / 320) * c.w);
    const y = Math.round(c.y + (gy / 200) * c.h);
    if (x < 0 || y < 0 || x >= width || y >= height) return 0;
    const i = (y * width + x) * 4;
    return data[i] + data[i + 1] + data[i + 2];
  };
  let barDark = 0;
  let barN = 0;
  for (let gy = 44; gy <= 54; gy++) {
    for (let gx = 92; gx <= 168; gx++) {
      barN += 1;
      if (sample(gx, gy) < 300) barDark += 1;
    }
  }
  let emptyLight = 0;
  let emptyN = 0;
  for (let gy = 70; gy <= 100; gy += 2) {
    for (let gx = 96; gx <= 200; gx += 2) {
      emptyN += 1;
      if (sample(gx, gy) > 380) emptyLight += 1;
    }
  }
  let okDark = 0;
  let okN = 0;
  for (let gy = 108; gy <= 120; gy++) {
    for (let gx = 188; gx <= 224; gx++) {
      okN += 1;
      if (sample(gx, gy) < 300) okDark += 1;
    }
  }
  return barN > 0 && barDark / barN > 0.35 && emptyN > 0 && emptyLight / emptyN > 0.55 && okN > 0 && okDark / okN > 0.05;
}

async function stillGeosDesk(hand) {
  const desk = await canvasLooksLikeGeosDesktop(hand.page);
  const text = await hand.screenText();
  const basic = isStillBasicNotGeos(text);
  return { desk: desk.pass, basic, pass: Boolean(desk.pass && !basic), stats: desk.stats };
}

function notepadHasIcons(img) {
  const c = contentRect(img);
  if (!c) return false;
  const { data, width } = img;
  let dark = 0;
  let n = 0;
  for (let gy = 44; gy < 115; gy++) {
    for (let gx = 20; gx < 240; gx++) {
      const x = Math.round(c.x + (gx / 320) * c.w);
      const y = Math.round(c.y + (gy / 200) * c.h);
      const i = (y * width + x) * 4;
      n += 1;
      if (data[i] + data[i + 1] + data[i + 2] < 300) dark += 1;
    }
  }
  return n > 0 && dark / n > 0.02;
}

function iconRegionChanged(a, b, { minChanged = 180 } = {}) {
  if (!a?.img || !b?.img) return { pass: false, changed: 0 };
  const pad = notepadBodyRect(b.img) || notepadBodyRect(a.img) || notepadRect(b.img) || notepadRect(a.img);
  if (!pad) return movedEnough(a, b, { minChanged, minInk: 8 });
  const diff = frameDiff(a.img, b.img, { rect: pad, skipTop: 0 });
  return { pass: diff.changed >= minChanged, changed: diff.changed, cx: diff.cx, cy: diff.cy };
}

async function savePng(dir, name, b64) {
  if (!b64) return;
  writeFileSync(join(dir, name), Buffer.from(b64, "base64"));
}

async function importOnly(hand, file, prefix) {
  const rows = (await hand.libraryRows()).filter((r) => r.name === file.name);
  const good = rows.filter((r) => r.sha1 === file.sha1);
  if (rows.length === 1 && good.length === 1) return { imported: false, rowSha1: good[0].sha1 };
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
  await hand.closeSheet().catch(() => {});
  await hand.key("Escape").catch(() => {});
  await sleep(300);
  await hand.openLibrary();
  const card = hand.page.locator(".g64-card").filter({ has: hand.page.getByText(file.name, { exact: true }) }).first();
  await card.waitFor({ state: "attached", timeout: 30_000 });
  const play = hand.page.getByRole("button", { name: `Play ${file.name}`, exact: true });
  const run = hand.page.getByRole("button", { name: `Run ${file.name}`, exact: true });
  const btn = (await play.count()) ? play.first() : run.first();
  await btn.waitFor({ state: "attached", timeout: 20_000 });
  try {
    await hand.reveal(btn, `Play ${file.name}`);
    await hand.shot(`${prefix}-row.png`);
    await hand.click(btn, `Play ${file.name}`);
  } catch {
    await tapBox(hand, btn, `Play ${file.name}`);
  }
  await waitFor(async () => !(await hand.sheetOpen()), 15_000);
}

async function tapBox(hand, locator, label) {
  const box = await locator.boundingBox();
  if (!box || box.width < 4 || box.height < 4) throw new Error(`${label}: no box`);
  await hand.xmove(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(80);
  await hand.sh("xdotool", ["click", "1"]);
}

async function ensureSetting(hand, label, on, read) {
  const cur = await read();
  if (cur === on) return { clicked: false, on };
  await hand.closeSheet().catch(() => {});
  await hand.openSettings();
  const row = hand.page.locator(".g64-row").filter({ hasText: label }).first();
  await row.waitFor({ state: "attached", timeout: 15_000 });
  const sw = row.locator('button[role="switch"]').first();
  await hand.reveal(sw, label);
  await hand.click(sw, `${label} → ${on ? "on" : "off"}`);
  await sleep(250);
  await hand.closeSheet();
  const after = await read();
  if (after !== on) throw new Error(`${label} stayed ${after ? "on" : "off"}`);
  return { clicked: true, on };
}

async function ensureMouse(hand, on) {
  return ensureSetting(hand, "1351 mouse + touchpad", on, () =>
    hand.page.evaluate(() => window.__g64?.settings?.()?.mouseMode === true),
  );
}

async function ensureWasd(hand, on) {
  return ensureSetting(hand, "Keyboard joystick (WASD)", on, () =>
    hand.page.evaluate(() => window.__g64?.settings?.()?.wasdIsJoy === true),
  );
}

async function ensurePort(hand, port) {
  for (let i = 0; i < 4; i++) {
    const cur = await hand.page.evaluate(() => window.__g64?.joyPort?.() ?? null);
    if (cur === port) return { port };
    const btn = hand.page.locator(".g64-port").filter({ hasText: /^P[12]$/ }).first();
    await tapBox(hand, btn, `P${cur} → swap`);
    await sleep(250);
  }
  const cur = await hand.page.evaluate(() => window.__g64?.joyPort?.() ?? null);
  if (cur !== port) throw new Error(`port stayed ${cur}, wanted ${port}`);
  return { port };
}

async function holdPoint(hand, x, y, ms) {
  await hand.xmove(x, y);
  await sleep(80);
  await hand.sh("xdotool", ["mousedown", "1"]);
  await sleep(ms);
  await hand.sh("xdotool", ["mouseup", "1"]);
}

async function dragBox(hand, box, { from = [0.25, 0.4], to = [0.8, 0.7], steps = 12, stepMs = 40 } = {}) {
  const x0 = box.x + box.width * from[0];
  const y0 = box.y + box.height * from[1];
  const x1 = box.x + box.width * to[0];
  const y1 = box.y + box.height * to[1];
  await hand.xmove(x0, y0);
  await sleep(80);
  await hand.sh("xdotool", ["mousedown", "1"]);
  for (let i = 1; i <= steps; i++) {
    await hand.xmove(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
    await sleep(stepMs);
  }
  await hand.sh("xdotool", ["mouseup", "1"]);
}

async function holdStick(hand, dir, ms) {
  const stick = hand.page.locator(".g64-stick").first();
  const box = await hand.reveal(stick, "on-screen stick");
  const cx = box.x + box.width * 0.5;
  const cy = box.y + box.height * 0.5;
  const nx = dir === "right" ? 0.7 : dir === "left" ? 0.3 : 0.5;
  const ny = dir === "down" ? 0.7 : dir === "up" ? 0.3 : 0.5;
  const tx = box.x + box.width * nx;
  const ty = box.y + box.height * ny;
  await hand.xmove(cx, cy);
  await sleep(80);
  await hand.sh("xdotool", ["mousedown", "1"]);
  await sleep(50);
  for (let i = 1; i <= 6; i++) {
    await hand.xmove(cx + ((tx - cx) * i) / 6, cy + ((ty - cy) * i) / 6);
    await sleep(28);
  }
  const joyMid = await hand.page.evaluate(() => window.__g64?.joy?.() ?? null);
  await sleep(ms);
  const joy = await hand.page.evaluate(() => window.__g64?.joy?.() ?? null);
  await hand.sh("xdotool", ["mouseup", "1"]);
  return { box, joyMid, joy };
}

async function holdWasd(hand, key, ms) {
  await hand.sh("xdotool", ["keydown", key]);
  await sleep(ms);
  await hand.sh("xdotool", ["keyup", key]);
}

async function setJoy(hand, x, y, fire = false) {
  await hand.page.evaluate(({ x, y, fire }) => window.__g64?.setJoy?.(x, y, fire), { x, y, fire });
}

async function holdJoy(hand, x, y, ms) {
  await setJoy(hand, x, y, false);
  await sleep(ms);
  await setJoy(hand, 0, 0, false);
}

async function clickJoy(hand, { double = false, downMs = 70, gapMs = 90 } = {}) {
  await setJoy(hand, 0, 0, true);
  await sleep(downMs);
  await setJoy(hand, 0, 0, false);
  if (double) {
    await sleep(gapMs);
    await setJoy(hand, 0, 0, true);
    await sleep(downMs);
    await setJoy(hand, 0, 0, false);
  }
}

async function tapC64Key(hand, code, key, holdMs = 80) {
  await hand.page.evaluate(async ({ code, key, holdMs }) => {
    const g = window.__g64;
    g?.dispatchKey?.(code, key, true);
    await new Promise((r) => setTimeout(r, holdMs));
    g?.dispatchKey?.(code, key, false);
  }, { code, key, holdMs });
  await sleep(140);
}

/** Official GEOS: C= + I opens select input (keyboard path when the pointer is wrong). */
async function tapCbmI(hand) {
  await hand.click(hand.crt(), "crt");
  await sleep(80);
  await hand.page.evaluate(async () => {
    const g = window.__g64;
    g?.kbdReleaseAll?.();
    g?.dispatchKey?.("ControlLeft", "Control", true);
    await new Promise((r) => setTimeout(r, 80));
    g?.dispatchKey?.("KeyI", "i", true);
    await new Promise((r) => setTimeout(r, 120));
    g?.dispatchKey?.("KeyI", "i", false);
    g?.dispatchKey?.("ControlLeft", "Control", false);
  });
  await sleep(400);
}

function isSelectInputDialog(before, after) {
  if (!after?.img) return false;
  if (looksLikeSelectInput(after.img)) return true;
  if (!before?.img) return false;
  return looksLikeCenteredDialog(before, after) && notepadHasIcons(after.img);
}

async function waitSelectInput(hand, before, ms = 8000) {
  const t0 = Date.now();
  let last = await snapshot(hand.page);
  while (Date.now() - t0 < ms) {
    if (isSelectInputDialog(before, last)) return last;
    await sleep(350);
    last = await snapshot(hand.page);
  }
  return last;
}

async function pickComm1351InDialog(hand, dlg) {
  // Sprite centroid sits ~6px below the tip. COMM 1351(a) ink is GEOS y≈56–62;
  // walking to y=72 clicked empty dialog and left JOYSTICK selected.
  await tapC64Key(hand, "ArrowDown", "ArrowDown");
  await sleep(180);
  const comm = geosMap(dlg.img, 118, 64);
  const ok = geosMap(dlg.img, 204, 118);
  if (comm) await walkPointerTo(hand, comm.x, comm.y, { timeout: 4000, close: 10 });
  await clickJoy(hand, { downMs: 110 });
  await sleep(250);
  if (ok) await walkPointerTo(hand, ok.x, ok.y, { timeout: 3500, close: 10 });
  await clickJoy(hand, { downMs: 110 });
  await sleep(400);
}

async function locatePointer(hand, { dirs = null, pulseMs = 55 } = {}) {
  for (const [jx, jy] of dirs || [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const before = await snapshot(hand.page);
    await setJoy(hand, jx, jy, false);
    await sleep(pulseMs);
    await setJoy(hand, 0, 0, false);
    await sleep(45);
    const after = await snapshot(hand.page);
    const diff = frameDiff(before.img, after.img, { skipTop: 4 });
    if (diff.changed >= 6) return { x: diff.cx, y: diff.cy, changed: diff.changed, dir: [jx, jy] };
  }
  return null;
}

function toGeos(pt, img) {
  const c = contentRect(img);
  if (!c || !pt) return null;
  return { x: ((pt.x - c.x) / c.w) * 320, y: ((pt.y - c.y) / c.h) * 200 };
}

function inMinusBox(g) {
  return Boolean(g && g.x >= 238 && g.x <= 260 && g.y >= 16 && g.y <= 28);
}

/** Official deskTop menu bar: geos is x≈5–28 (center ~16). file starts ~32. */
function onGeosWord(g) {
  return Boolean(g && g.x >= 8 && g.x <= 24 && g.y >= 0 && g.y <= 16);
}

/** Pointer on the geos menu's select input line (4th item; GEOS info / deskTop info / select printer / select input). */
function onSelectInputItem(g) {
  return Boolean(g && g.x < 90 && g.y >= 48 && g.y <= 72);
}

/** Gutter blob on an open menu — do not pulse, pulsing walks off the item. */
function findMenuPointer(img) {
  const c = contentRect(img);
  if (!c) return null;
  const { data, width } = img;
  const rows = [];
  for (let gy = 16; gy < 110; gy++) {
    let n = 0;
    let sx = 0;
    for (let gx = 1; gx < 12; gx++) {
      const x = Math.round(c.x + (gx / 320) * c.w);
      const y = Math.round(c.y + (gy / 200) * c.h);
      const i = (y * width + x) * 4;
      if (data[i] + data[i + 1] + data[i + 2] < 200) {
        n += 1;
        sx += gx;
      }
    }
    rows.push({ y: gy, n, x: n ? sx / n : 0 });
  }
  const ranked = [...rows].sort((a, b) => a.n - b.n);
  const med = ranked[Math.floor(ranked.length / 2)]?.n ?? 0;
  const best = rows.reduce((a, b) => (b.n > a.n ? b : a), rows[0]);
  if (!best || best.n < 3 || best.n < med + 2) return null;
  return { x: best.x, y: best.y, n: best.n, med };
}

/** geos info is a prose box. select input is a driver list with OK/Cancel. */
function looksLikeAboutBox(img) {
  const c = contentRect(img);
  if (!c) return false;
  const { data, width } = img;
  let white = 0;
  let dark = 0;
  let n = 0;
  for (let gy = 36; gy < 150; gy++) {
    for (let gx = 70; gx < 250; gx++) {
      const x = Math.round(c.x + (gx / 320) * c.w);
      const y = Math.round(c.y + (gy / 200) * c.h);
      const i = (y * width + x) * 4;
      const s = data[i] + data[i + 1] + data[i + 2];
      n += 1;
      if (s > 600) white += 1;
      else if (s < 240) dark += 1;
    }
  }
  if (n < 200) return false;
  const wf = white / n;
  const df = dark / n;
  return wf > 0.45 && df > 0.04 && df < 0.22;
}

/** Dropdown left edge: geos ~5, file ~32, view ~70. */
function openedMenuKind(before, after) {
  if (!before?.img || !after?.img) return { kind: "none" };
  const c = contentRect(after.img);
  if (!c) return { kind: "none" };
  const { data, width } = after.img;
  const prev = before.img.data;
  const cols = new Array(160).fill(0);
  for (let gy = 18; gy < 96; gy++) {
    for (let gx = 0; gx < 160; gx++) {
      const x = Math.round(c.x + (gx / 320) * c.w);
      const y = Math.round(c.y + (gy / 200) * c.h);
      const i = (y * width + x) * 4;
      const d =
        Math.abs(data[i] - prev[i]) +
        Math.abs(data[i + 1] - prev[i + 1]) +
        Math.abs(data[i + 2] - prev[i + 2]);
      if (d > 40) cols[gx] += 1;
    }
  }
  let left = -1;
  let right = -1;
  let best = 0;
  let bestL = -1;
  let bestR = -1;
  for (let gx = 0; gx < 160; gx++) {
    if (cols[gx] >= 8) {
      if (left < 0) left = gx;
      right = gx;
    } else if (left >= 0) {
      if (right - left > best) {
        best = right - left;
        bestL = left;
        bestR = right;
      }
      left = -1;
    }
  }
  if (left >= 0 && right - left > best) {
    bestL = left;
    bestR = right;
  }
  if (bestL < 0 || bestR - bestL < 20) return { kind: "none" };
  const kind = bestL <= 24 ? "geos" : bestL <= 55 ? "file" : "view";
  return { kind, left: bestL, right: bestR };
}

async function landOnGeosWord(hand) {
  const trace = { hops: [] };
  const horiz = [
    [-1, 0],
    [1, 0],
  ];
  for (let i = 0; i < 24; i++) {
    const snap = await snapshot(hand.page);
    const lastX = trace.hops.length ? trace.hops[trace.hops.length - 1].x : 200;
    const loc = await locatePointer(hand, { dirs: horiz, pulseMs: lastX <= 40 ? 22 : 40 });
    const g = toGeos(loc, snap.img);
    if (g && lastX < 80 && Math.abs(g.x - lastX) > 40) {
      await holdJoy(hand, -1, 0, 40);
      continue;
    }
    if (g) trace.hops.push({ i, x: +g.x.toFixed(1), y: +g.y.toFixed(1) });
    if (onGeosWord(g)) {
      trace.landed = g;
      return trace;
    }
    if (!g) {
      await holdJoy(hand, -1, 0, 100);
      continue;
    }
    if (g.y > 16) await holdJoy(hand, 0, -1, 70);
    else if (g.x > 24) await holdJoy(hand, -1, 0, g.x > 40 ? 70 : 40);
    else if (g.x < 8) await holdJoy(hand, 1, 0, 36);
    else await holdJoy(hand, 1, 0, 30);
  }
  const snap = await snapshot(hand.page);
  const loc = await locatePointer(hand, { dirs: horiz, pulseMs: 22 });
  trace.landed = toGeos(loc, snap.img);
  return trace;
}

async function landOnPageNumber(hand) {
  const trace = { hops: [] };
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (let i = 0; i < 20; i++) {
    const snap = await snapshot(hand.page);
    const loc = await locatePointer(hand, { dirs, pulseMs: 48 });
    const g = toGeos(loc, snap.img);
    if (g) trace.hops.push({ i, x: +g.x.toFixed(1), y: +g.y.toFixed(1) });
    if (inPageNumberBox(g)) {
      trace.landed = g;
      return trace;
    }
    if (!g) {
      await holdJoy(hand, 0, 1, 80);
      continue;
    }
    if (g.y < 100) {
      await holdJoy(hand, 0, 1, 95);
      continue;
    }
    if (g.y > 136) {
      await holdJoy(hand, 0, -1, 80);
      continue;
    }
    if (g.x < 128) await holdJoy(hand, 1, 0, 80);
    else if (g.x > 152) await holdJoy(hand, -1, 0, 80);
    else await holdJoy(hand, 0, 1, 70);
  }
  const snap = await snapshot(hand.page);
  const loc = await locatePointer(hand, { dirs, pulseMs: 48 });
  trace.landed = toGeos(loc, snap.img);
  return trace;
}

/** GEOS joystick snaps to the clock above the close box — kept for recovery only. */
async function landOnNotepadMinus(hand) {
  const trace = { hops: [] };
  const horiz = [
    [1, 0],
    [-1, 0],
    [0, 1],
  ];
  for (let i = 0; i < 18; i++) {
    const snap = await snapshot(hand.page);
    const loc = await locatePointer(hand, { dirs: horiz, pulseMs: 48 });
    const g = toGeos(loc, snap.img);
    if (g) trace.hops.push({ i, x: +g.x.toFixed(1), y: +g.y.toFixed(1) });
    if (inMinusBox(g)) {
      trace.landed = g;
      return trace;
    }
    if (!g) {
      await holdJoy(hand, 1, 0, 80);
      continue;
    }
    if (g.y < 15) {
      await holdJoy(hand, 0, 1, 90);
      continue;
    }
    if (g.y > 30) {
      await holdJoy(hand, 0, -1, 80);
      continue;
    }
    if (g.x < 240) await holdJoy(hand, 1, 0, 80);
    else if (g.x > 258) await holdJoy(hand, -1, 0, 80);
    else await holdJoy(hand, 0, 1, 70);
  }
  const snap = await snapshot(hand.page);
  const loc = await locatePointer(hand, { dirs: horiz, pulseMs: 48 });
  trace.landed = toGeos(loc, snap.img);
  return trace;
}

async function walkPointerTo(hand, tx, ty, { timeout = 4500, close = 20 } = {}) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    const loc = await locatePointer(hand);
    if (!loc) {
      await holdJoy(hand, 1, 0, 180);
      continue;
    }
    last = loc;
    const dx = tx - loc.x;
    const dy = ty - loc.y;
    if (Math.hypot(dx, dy) <= close) return loc;
    const sx = Math.abs(dx) > 8 ? Math.sign(dx) : 0;
    const sy = Math.abs(dy) > 8 ? Math.sign(dy) : 0;
    if (!sx && !sy) return loc;
    const ms = Math.min(420, Math.max(90, Math.hypot(dx, dy) * 3.2));
    await holdJoy(hand, sx, sy, ms);
  }
  return last;
}

async function uploadRom(hand, label, path) {
  await hand.openSettings();
  const row = hand.page.locator(".g64-filerow").filter({ hasText: label }).first();
  await row.waitFor({ state: "attached", timeout: 15_000 });
  const replace = row.getByRole("button", { name: "Replace", exact: true });
  if (await replace.isVisible().catch(() => false)) {
    await hand.closeSheet();
    return { uploaded: false, already: true };
  }
  const upload = row.getByRole("button", { name: "Upload", exact: true });
  await hand.reveal(upload, `Upload ${label}`);
  await hand.click(upload, `Upload ${label}`);
  await hand.chooseFileInDialog(path, { shotPrefix: `rom-${label.replace(/\s+/g, "-")}` });
  await sleep(800);
  await hand.closeSheet();
  return { uploaded: true };
}

async function basicKbjoy(hand, prefix) {
  const out = {};
  await ensureMouse(hand, false);
  await ensureWasd(hand, false);
  out.chipOff = await hand.page.evaluate(() => document.querySelector("[data-kbjoy]")?.getAttribute("data-kbjoy"));
  await hand.clickCrtAndType("NEW");
  await sleep(500);
  const before = await hand.screenText();
  await hand.clickCrtAndType("AD");
  await sleep(400);
  const typed = await hand.screenText();
  out.offTypesLetters = /AD/.test(typed) && typed.length >= before.length;
  await hand.shot(`${prefix}-kbjoy-off-ad.png`);
  await ensureWasd(hand, true);
  out.chipOn = await hand.page.evaluate(() => {
    const root = document.querySelector("[data-kbjoy]");
    return {
      root: document.documentElement.getAttribute("data-kbjoy"),
      chip: root?.getAttribute("data-kbjoy") ?? null,
      settings: window.__g64?.settings?.()?.wasdIsJoy ?? null,
    };
  });
  const mid = await hand.screenText();
  await hand.click(hand.crt(), "crt");
  await sleep(80);
  await hand.type("WS");
  await sleep(400);
  const afterOn = await hand.screenText();
  out.onSwallowsLetters = !/\bWS\b/.test(afterOn) && !/WS/.test(afterOn.replace(mid, ""));
  out.midTail = mid.split("\n").filter((l) => l.trim()).slice(-3);
  out.afterOnTail = afterOn.split("\n").filter((l) => l.trim()).slice(-3);
  await hand.shot(`${prefix}-kbjoy-on-ws.png`);
  await ensureWasd(hand, false);
  out.pass = Boolean(out.offTypesLetters && out.onSwallowsLetters);
  return out;
}

async function pointerProbe(hand, name, act, { settle = 450 } = {}) {
  const before = await snapshot(hand.page);
  await act();
  await sleep(settle);
  const after = await snapshot(hand.page);
  const move = movedEnough(before, after);
  return { name, ...move, beforeInk: before.ink, afterInk: after.ink, b64Before: before.b64, b64After: after.b64 };
}

async function testStickAndWasd(hand, prefix, { mouse = false } = {}) {
  const out = {};
  await ensureMouse(hand, mouse);
  await ensurePort(hand, 1);
  await ensureWasd(hand, false);
  let held = null;
  const right = await pointerProbe(hand, "stick-right", async () => {
    held = await holdStick(hand, "right", mouse ? 500 : 1400);
  }, { settle: 250 });
  await savePng(hand.shotDir(), `${prefix}-stick-right-before.png`, right.b64Before);
  await savePng(hand.shotDir(), `${prefix}-stick-right-after.png`, right.b64After);
  await hand.shot(`${prefix}-stick-right.png`);
  const afterHold = await snapshot(hand.page);
  await sleep(700);
  const afterRelease = await snapshot(hand.page);
  const coast = movedEnough(afterHold, afterRelease, { minChanged: 80, minInk: 6 });
  out.stick = {
    moved: right.pass,
    changed: right.changed,
    inkDist: right.inkDist,
    dx: right.dx,
    dy: right.dy,
    joyMid: held?.joyMid ?? null,
    joy: held?.joy ?? null,
  };
  out.stickSteady = { coastChanged: coast.changed, coastInk: coast.inkDist, pass: !coast.pass || coast.inkDist < 6 };
  await ensureWasd(hand, true);
  await hand.click(hand.crt(), "crt");
  await sleep(80);
  const wasd = await pointerProbe(hand, "wasd-d", () => holdWasd(hand, "d", mouse ? 450 : 1400), { settle: 250 });
  await savePng(hand.shotDir(), `${prefix}-wasd-d-after.png`, wasd.b64After);
  await hand.shot(`${prefix}-wasd-d.png`);
  out.wasd = { moved: wasd.pass, changed: wasd.changed, inkDist: wasd.inkDist, dx: wasd.dx, dy: wasd.dy };
  await ensureWasd(hand, false);
  const stickHeld = Math.abs(out.stick.joy?.x) >= 0.9 || Math.abs(out.stick.joyMid?.x) >= 0.9;
  out.pass = Boolean((out.stick.moved || stickHeld) && out.stickSteady.pass && out.wasd.moved);
  return out;
}

async function test1351(hand, prefix) {
  const out = {};
  await ensurePort(hand, 1);
  await ensureMouse(hand, true);
  out.opts = await hand.page.evaluate(() => window.__g64?.runtimeViceOpts?.() ?? null);
  out.settings = await hand.page.evaluate(() => window.__g64?.settings?.() ?? null);
  out.core = await hand.coreStatus();
  out.vice1351Direct = await hand.page.evaluate(() => window.__g64?.vice1351Direct?.() ?? null);
  const pad = hand.page.locator(".g64-touchpad").first();
  const padBox = await hand.reveal(pad, "trackpad");
  const track = await pointerProbe(hand, "trackpad", () =>
    dragBox(hand, padBox, { from: [0.4, 0.55], to: [0.62, 0.4], steps: 8, stepMs: 40 }),
  );
  await savePng(hand.shotDir(), `${prefix}-trackpad-before.png`, track.b64Before);
  await savePng(hand.shotDir(), `${prefix}-trackpad-after.png`, track.b64After);
  await hand.shot(`${prefix}-trackpad.png`);
  out.trackpad = { moved: track.pass, changed: track.changed, inkDist: track.inkDist, dx: track.dx, dy: track.dy };

  const crtBox = await hand.reveal(hand.crt(), "crt");
  const drag = await pointerProbe(hand, "canvas-drag", () =>
    dragBox(hand, crtBox, { from: [0.42, 0.4], to: [0.58, 0.52], steps: 8, stepMs: 35 }),
  );
  await savePng(hand.shotDir(), `${prefix}-drag-after.png`, drag.b64After);
  await hand.shot(`${prefix}-canvas-drag.png`);
  out.drag = { moved: drag.pass, changed: drag.changed, inkDist: drag.inkDist, dx: drag.dx, dy: drag.dy };

  await hand.page.evaluate(() => {
    for (let i = 0; i < 10; i++) window.__g64?.addMouseDelta?.(-14, -10);
  });
  await sleep(350);

  const left = hand.page.getByRole("button", { name: "Left mouse button" }).first();
  const click = await pointerProbe(hand, "left-click", async () => {
    await hand.click(left, "1351 left");
    await sleep(80);
  }, { settle: 450 });
  await savePng(hand.shotDir(), `${prefix}-click-after.png`, click.b64After);
  await hand.shot(`${prefix}-left-click.png`);
  out.click = { changed: click.changed, inkDist: click.inkDist, pass: click.changed >= 20 || click.inkDist >= 1.2 };

  const nudge = await pointerProbe(hand, "nudge", async () => {
    await hand.page.evaluate(() => window.__g64?.addMouseDelta?.(28, 16));
    await sleep(80);
    await hand.page.evaluate(() => window.__g64?.addMouseDelta?.(28, 16));
  }, { settle: 400 });
  await savePng(hand.shotDir(), `${prefix}-nudge-after.png`, nudge.b64After);
  out.nudge = { moved: nudge.pass, changed: nudge.changed, inkDist: nudge.inkDist, dx: nudge.dx, dy: nudge.dy };

  out.pass = Boolean(out.trackpad.moved || out.drag.moved || out.nudge.moved);
  out.clickPass = Boolean(out.click.pass);
  return out;
}

/** C= + I opens Select Input Device; pick COMM 1351(a) + OK. */
async function activateGeos1351(hand) {
  const out = { steps: [], file: "COMM 1351(a)", via: "select-input" };
  await ensureMouse(hand, false);
  await ensurePort(hand, 1);
  await ensureWasd(hand, false);
  const before = await snapshot(hand.page);
  await savePng(hand.shotDir(), "10-1351-before.png", before.b64);

  await tapCbmI(hand);
  out.steps.push("cbm-i");
  let dlg = await waitSelectInput(hand, before, 10000);
  if (!isSelectInputDialog(before, dlg)) {
    await tapCbmI(hand);
    out.steps.push("cbm-i-retry");
    dlg = await waitSelectInput(hand, before, 8000);
  }
  await savePng(hand.shotDir(), "10-1351-page-menu.png", dlg.b64);
  await hand.shot("10-1351-select-input.png");
  // C= + I opens Select Input Device, never the about box — don't reject a white dialog.
  out.dialog = isSelectInputDialog(before, dlg);

  if (!out.dialog) {
    out.landGeos = await landOnGeosWord(hand);
    out.steps.push(onGeosWord(out.landGeos?.landed) ? "on-geos" : "geos-miss");
    await hand.shot("10-1351-preclick.png");
    if (onGeosWord(out.landGeos?.landed)) {
      await clickJoy(hand, { downMs: 120 });
      await sleep(500);
    }
    await hand.shot("10-1351-geos-menu.png");
    const menuSnap = await snapshot(hand.page);
    out.menu = openedMenuKind(before, menuSnap);
    if (out.menu.kind === "geos") {
      out.menuWalk = [];
      for (let i = 0; i < 6; i++) {
        const row = await snapshot(hand.page);
        await savePng(hand.shotDir(), `10-1351-menu-walk-${i}.png`, row.b64);
        if (looksLikeAboutBox(row.img)) {
          out.steps.push("about-box");
          await clickJoy(hand, { downMs: 110 });
          await sleep(250);
          break;
        }
        if (i > 0 && isSelectInputDialog(before, row)) {
          out.steps.push("select-input-menu");
          dlg = row;
          out.dialog = true;
          break;
        }
        const ptr = findMenuPointer(row.img);
        if (ptr) out.menuWalk.push({ i, x: +ptr.x.toFixed(1), y: ptr.y, n: ptr.n, med: ptr.med });
        const alreadyThere = onSelectInputItem(ptr) || (i === 0 && !ptr);
        if (alreadyThere || i === 4) {
          await clickJoy(hand, { downMs: 120 });
          await sleep(900);
          out.steps.push(alreadyThere ? "select-input-menu" : "select-input-after-walk");
          break;
        }
        if (ptr && ptr.y > 72) await holdJoy(hand, 0, -1, 36);
        else await holdJoy(hand, 0, 1, 36);
        await sleep(140);
      }
      if (!out.dialog) {
        dlg = await waitSelectInput(hand, before, 8000);
        out.dialog = isSelectInputDialog(before, dlg);
      }
    } else {
      out.steps.push(out.menu.kind === "none" ? "no-menu" : "wrong-menu");
    }
  }

  if (out.dialog) {
    await savePng(hand.shotDir(), "10-1351-input-dialog.png", dlg.b64);
    await hand.shot("10-1351-input-dialog-ui.png");
    await pickComm1351InDialog(hand, dlg);
    out.steps.push("pick-1351");
    for (const [code, key] of [
      ["ArrowDown", "ArrowDown"],
      ["Enter", "Enter"],
      ["ArrowRight", "ArrowRight"],
      ["Enter", "Enter"],
    ]) {
      const now = await snapshot(hand.page);
      if (!isSelectInputDialog(before, now)) break;
      await tapC64Key(hand, code, key);
    }
    out.steps.push("ok");
    for (let i = 0; i < 16; i++) {
      await sleep(400);
      const now = await snapshot(hand.page);
      if (!isSelectInputDialog(before, now)) break;
    }
  } else {
    out.steps.push("page-flip");
    out.landPage = await landOnPageNumber(hand);
    await clickJoy(hand, { downMs: 110 });
    await sleep(800);
    let page2 = await snapshot(hand.page);
    if (isSelectInputDialog(before, page2)) {
      out.dialog = true;
      await pickComm1351InDialog(hand, page2);
      out.steps.push("pick-1351", "ok");
    } else {
      if (!notepadHasIcons(page2.img) || !iconRegionChanged(before, page2, { minChanged: 120 }).pass) {
        await clickJoy(hand, { downMs: 110 });
        await sleep(800);
        page2 = await snapshot(hand.page);
      }
      await savePng(hand.shotDir(), "10-1351-page2.png", page2.b64);
      await hand.shot("10-1351-page2-ui.png");
      const target = comm1351Pos(page2.img);
      out.commTarget = target ? { x: target.x, y: target.y } : null;
      if (target) {
        out.walkComm = await walkPointerTo(hand, target.x, target.y, { timeout: 8000, close: 8 });
        out.steps.push("comm-cell");
      }
      await clickJoy(hand, { double: true, downMs: 110 });
      await sleep(3600);
      out.steps.push("comm-open");
    }
  }
  const after = await snapshot(hand.page);
  await savePng(hand.shotDir(), "10-1351-after.png", after.b64);
  await hand.shot("10-1351-after-ui.png");
  const live = await stillGeosDesk(hand);
  out.afterDesk = live;
  out.basic = live.basic;
  out.icons = notepadHasIcons(after.img);
  out.dialogGone = !isSelectInputDialog(before, after);
  out.after = movedEnough(dlg, after, { minChanged: 80, minInk: 3 });
  const opened = out.steps.includes("ok") || out.steps.includes("comm-open") || out.steps.includes("pick-1351");
  out.pass = Boolean(opened && out.dialogGone && out.icons && live.pass && !live.basic);
  return out;
}

async function bootOfficialGeos(hand, disk, jiffy = false) {
  await hand.page.evaluate(() => window.__g64?.kbdReleaseAll?.());
  if (jiffy) {
    // JiffyDOS + host xdotool prepends a "4"/← and turns NEW/LOAD into SAVE.
    await hand.page.evaluate(async () => {
      await window.__g64?.feedBasic?.('LOAD"BOOT",8,1');
    });
    await sleep(400);
  } else {
    await hand.clickCrtAndType('LOAD"BOOT",8,1');
  }
  let loadLine = await hand.waitTypedLine('LOAD"BOOT",8,1');
  if (!loadLine.found) {
    const typed = await hand.screenText();
    const compact = typed.replace(/\s+/g, "").toUpperCase();
    loadLine = { ...loadLine, found: compact.includes('LOAD"BOOT",8,1') || /SEARCHING FOR BOOT|LOADING/i.test(typed) };
  }
  const typed = await hand.screenText();
  if (/SAVING BOOT/i.test(typed) && !/SEARCHING FOR BOOT|LOADING/i.test(typed)) {
    await hand.page.evaluate(() => window.__g64?.kbdReleaseAll?.());
    await sleep(200);
    await hand.page.evaluate(async () => {
      await window.__g64?.feedBasic?.('LOAD"BOOT",8,1');
    });
    await sleep(400);
    loadLine = (await hand.waitTypedLine('LOAD"BOOT",8,1')) || loadLine;
  }
  await hand.shot("05-load-boot-typed.png");
  const boot = await waitGeosBoot(hand.page, {
    command: 'LOAD"BOOT",8,1',
    typeRun: async () => {
      await hand.shot("06-load-boot-ready.png");
      await hand.type("RUN");
      await hand.key("Return");
    },
    deskTopMs,
    onTick: async (ms) => {
      if (ms > 0 && ms % 30_000 < 1200) await hand.shot(`06-booting-${Math.round(ms / 1000)}s.png`);
    },
  });
  const desk = await canvasLooksLikeGeosDesktop(hand.page);
  let snap = await snapshot(hand.page);
  let prevInk = 0;
  for (let i = 0; i < 24; i++) {
    const n = snap.ink?.n ?? 0;
    if (n > 25_000 && Math.abs(n - prevInk) < 500) break;
    prevInk = n;
    await sleep(500);
    snap = await snapshot(hand.page);
  }
  await savePng(hand.shotDir(), "07-desktop.png", snap.b64);
  await hand.shot(desk.pass || boot.deskTop?.pass ? "07-desktop-ui.png" : "07-no-desktop.png");
  return { loadLine, boot, desk, screen: (await hand.screenText()).slice(0, 400) };
}

async function runGeosMode(hand, disk, jiffy) {
  const mode = jiffy ? "jiffy-on" : "jiffy-off";
  const shotDir = join(shotRoot, "geos", mode);
  mkdirSync(shotDir, { recursive: true });
  hand.setShotDir(shotDir);
  const trace = { disk: disk.name, mode, jiffy };
  await hand.ensurePowered();
  trace.library = await hand.ensureInLibrary(disk, { shotPrefix: "00-import" });
  trace.jiffySwitch = await hand.setJiffy(jiffy, { shot: "01-settings-jiffy.png" });
  trace.power = await hand.powerCycle({ offShot: "02-power-off.png", onShot: "02-power-on-ready.png" });
  if (!trace.power.ready) throw new Error(`${mode}: no READY after Power on`);
  trace.banner = (await hand.screenText()).split("\n").filter((l) => l.trim()).slice(0, 3).join(" | ");
  trace.jiffyLive = await hand.page.evaluate(() => window.__g64?.jiffyLive?.() ?? null);
  trace.jiffyBanner = /JIFFYDOS/i.test(trace.banner);
  trace.jiffyOk = jiffy ? trace.jiffyLive === true && trace.jiffyBanner : trace.jiffyLive !== true && !trace.jiffyBanner;
  Object.assign(trace, await hand.insertFromLibrary(disk, { unit: 8, shot: "03-library-row.png", readyShot: "03-inserted-ready.png" }));
  trace.kbjoy = await basicKbjoy(hand, "04");
  trace.geos = await bootOfficialGeos(hand, disk, jiffy);
  trace.deskTop = Boolean(trace.geos.desk?.pass || trace.geos.boot?.deskTop?.pass);
  if (trace.deskTop) {
    trace.joystick = await testStickAndWasd(hand, "08");
    trace.comm1351 = await activateGeos1351(hand);
    const afterComm = await stillGeosDesk(hand);
    trace.stillDeskAfterComm = afterComm;
    if (trace.comm1351 && !afterComm.pass) trace.comm1351.pass = false;
    if (afterComm.pass && trace.comm1351?.pass && trace.comm1351?.dialogGone !== false) {
      trace.mouse = await test1351(hand, "09");
      const afterMouse = await stillGeosDesk(hand);
      trace.stillDeskAfterMouse = afterMouse;
      if (!afterMouse.pass && trace.mouse) {
        trace.mouse.pass = false;
        trace.mouse.leftDesk = true;
      }
    } else {
      trace.mouse = { pass: false, skipped: true, reason: "COMM 1351 not on deskTop" };
    }
  }
  trace.pass = Boolean(
    trace.jiffyOk &&
      trace.insertLeftReady &&
      trace.kbjoy?.pass &&
      trace.deskTop &&
      trace.joystick?.pass &&
      trace.comm1351?.pass &&
      trace.mouse?.pass &&
      !trace.comm1351?.basic &&
      trace.stillDeskAfterComm?.pass &&
      trace.stillDeskAfterMouse?.pass,
  );
  return trace;
}

async function runGui64(hand, cart, tag) {
  const shotDir = join(shotRoot, tag);
  mkdirSync(shotDir, { recursive: true });
  hand.setShotDir(shotDir);
  const trace = { cart: cart.name, tag };
  await hand.ensurePowered();
  await hand.closeSheet().catch(() => {});
  await hand.key("Escape").catch(() => {});
  await sleep(400);
  trace.library = await importOnly(hand, cart, "00-import");
  await playFromLibrary(hand, cart, "01-play");
  const running = await waitFor(
    async () => (await hand.page.evaluate(() => window.__g64?.running?.() && !window.__g64?.booting?.())) || null,
    180_000,
    500,
  );
  trace.started = Boolean(running);
  await sleep(5000);
  const gui = await canvasLooksLikeGui64(hand.page);
  const snap = await snapshot(hand.page);
  await savePng(shotDir, "02-gui.png", snap.b64);
  await hand.shot("02-gui-ui.png");
  trace.gui = { pass: gui.pass, buckets: gui.stats?.buckets, geosDesk: gui.stats?.geosDesk, ink: gui.stats?.ink, src: gui.stats?.src };
  trace.video = await hand.page.evaluate(() => window.__g64?.video?.());
  if (trace.started) {
    trace.joystick = await testStickAndWasd(hand, "03", { mouse: true });
    trace.mouse = await test1351(hand, "04");
    await ensureMouse(hand, true);
    await ensurePort(hand, 1);
    const parked = await snapshot(hand.page);
    const pad = contentRect(parked.img);
    const cEquals = pad
      ? { x: pad.x + pad.w * 0.1, y: pad.y + pad.h * 0.9 }
      : geosMap(parked.img, 20, 188);
    if (cEquals) await walkPointerTo(hand, cEquals.x, cEquals.y, { timeout: 6000, close: 12 });
    else {
      await hand.page.evaluate(() => {
        for (let i = 0; i < 10; i++) window.__g64?.addMouseDelta?.(-20, 24);
      });
      await sleep(200);
    }
    const driveClick = await pointerProbe(hand, "c64-click", async () => {
      const left = hand.page.getByRole("button", { name: "Left mouse button" }).first();
      await hand.click(left, "1351 left");
      await sleep(80);
    }, { settle: 800 });
    await savePng(shotDir, "05-drive8-before.png", driveClick.b64Before);
    await savePng(shotDir, "05-drive8-after.png", driveClick.b64After);
    await hand.shot("05-drive8-click.png");
    trace.driveClick = {
      changed: driveClick.changed,
      inkDist: driveClick.inkDist,
      pass: driveClick.changed >= 80 || driveClick.inkDist >= 3,
    };
    if (trace.mouse) trace.mouse.clickPass = Boolean(trace.mouse.clickPass || trace.driveClick.pass);
  }
  const wantStd = /PAL/i.test(cart.name) ? "pal" : "ntsc";
  trace.videoOk = trace.video?.resolved === wantStd || trace.video?.software === wantStd;
  trace.pass = Boolean(trace.started && trace.gui.pass && trace.joystick?.pass && trace.mouse?.pass);
  return trace;
}

async function main() {
  const wantJiffyOn = modes.includes(true);
  for (const [k, p] of Object.entries(files)) {
    if (k.startsWith("jiffy") && !wantJiffyOn) continue;
    if (!existsSync(p)) {
      console.log(JSON.stringify({ pass: false, skipped: true, reason: `missing ${k}`, path: p }, null, 2));
      process.exit(k.startsWith("jiffy") ? 0 : 1);
    }
  }
  const geos = media(files.geos);
  const ntsc = media(files.ntsc);
  const pal = media(files.pal);
  const cfg = handConfig();
  const run = {
    media: { geos: geos.name, geosSha1: geos.sha1, ntsc: ntsc.name, pal: pal.name },
    modes: modes.map((j) => (j ? "on" : "off")),
    geos: {},
    gui64: {},
  };

  await withHandDisplay(cfg, async () => {
    const hand = await openHand(cfg, { shotDir: join(shotRoot, "boot") });
    try {
      run.start = await hand.start();
      run.core = await hand.coreStatus();
      await hand.shot("00-home.png");
      await hand.ensurePowered();
      await hand.shot("01-ready.png");
      if (existsSync(files.jiffyC64) && existsSync(files.jiffy1541)) {
        run.roms = {
          c64: await uploadRom(hand, "JiffyDOS C64", files.jiffyC64),
          d1541: await uploadRom(hand, "JiffyDOS 1541", files.jiffy1541),
        };
      }
      writeRun(run);
      for (const jiffy of modes) {
        const key = jiffy ? "jiffyOn" : "jiffyOff";
        try {
          run.geos[key] = await runGeosMode(hand, geos, jiffy);
        } catch (err) {
          run.geos[key] = { pass: false, error: String(err?.stack || err) };
          await hand.shot(`geos-${key}-error.png`).catch(() => {});
        }
        writeRun(run);
      }
      if (wantGui64 && process.env.GROK64_HAND_SKIP_GUI64 !== "1") {
        try {
          run.gui64.ntsc = await runGui64(hand, ntsc, "gui64-ntsc");
        } catch (err) {
          run.gui64.ntsc = { pass: false, error: String(err?.stack || err) };
        }
        writeRun(run);
        try {
          run.gui64.pal = await runGui64(hand, pal, "gui64-pal");
        } catch (err) {
          run.gui64.pal = { pass: false, error: String(err?.stack || err) };
        }
      } else {
        run.gui64.skipped = true;
      }
      run.coreAfter = await hand.coreStatus();
      run.errors = hand.errors.slice(0, 12);
    } finally {
      try {
        const seedUrl = new URL("grok64-gate-seed", cfg.base).href;
        await hand.page.route(seedUrl, (r) =>
          r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>seed</title>" }),
        );
        await hand.page.goto(seedUrl);
        await seedTomReusedProfile(hand.page, { jiffyDos: false });
      } catch {
        /* later gates still need Tom's stored settings */
      }
      await hand.close();
    }
  });

  const skipGui = !wantGui64 || process.env.GROK64_HAND_SKIP_GUI64 === "1";
  run.pass = Boolean(
    (run.geos.jiffyOff?.pass ?? !modes.includes(false)) &&
      (run.geos.jiffyOn?.pass ?? !modes.includes(true)) &&
      (skipGui || (run.gui64.ntsc?.pass && run.gui64.pal?.pass)),
  );
  writeRun(run);
  console.log(JSON.stringify(run, null, 2));
  process.exit(run.pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
