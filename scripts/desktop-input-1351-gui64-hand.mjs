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
import { canvasLooksLikeGeosDesktop, canvasLooksLikeGui64, seedTomReusedProfile, waitGeosBoot } from "./desktop-qa-lib.mjs";
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

function frameDiff(a, b, { skipTop = 36 } = {}) {
  if (!a || !b || a.width !== b.width || a.height !== b.height) return { changed: 0 };
  let changed = 0;
  let sx = 0;
  let sy = 0;
  const y0 = Math.min(a.height, skipTop);
  for (let y = y0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
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
  const nx = dir === "right" ? 0.88 : dir === "left" ? 0.12 : 0.5;
  const ny = dir === "down" ? 0.88 : dir === "up" ? 0.12 : 0.5;
  await holdPoint(hand, box.x + box.width * nx, box.y + box.height * ny, ms);
  return box;
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

async function testStickAndWasd(hand, prefix) {
  const out = {};
  await ensureMouse(hand, false);
  await ensurePort(hand, 1);
  await ensureWasd(hand, false);
  const right = await pointerProbe(hand, "stick-right", () => holdStick(hand, "right", 1400), { settle: 250 });
  await savePng(hand.shotDir(), `${prefix}-stick-right-before.png`, right.b64Before);
  await savePng(hand.shotDir(), `${prefix}-stick-right-after.png`, right.b64After);
  await hand.shot(`${prefix}-stick-right.png`);
  const afterHold = await snapshot(hand.page);
  await sleep(700);
  const afterRelease = await snapshot(hand.page);
  const coast = movedEnough(afterHold, afterRelease, { minChanged: 80, minInk: 6 });
  out.stick = { moved: right.pass, changed: right.changed, inkDist: right.inkDist, dx: right.dx, dy: right.dy };
  out.stickSteady = { coastChanged: coast.changed, coastInk: coast.inkDist, pass: !coast.pass || coast.inkDist < 6 };
  await ensureWasd(hand, true);
  const wasd = await pointerProbe(hand, "wasd-d", () => holdWasd(hand, "d", 1400), { settle: 250 });
  await savePng(hand.shotDir(), `${prefix}-wasd-d-after.png`, wasd.b64After);
  await hand.shot(`${prefix}-wasd-d.png`);
  out.wasd = { moved: wasd.pass, changed: wasd.changed, inkDist: wasd.inkDist, dx: wasd.dx, dy: wasd.dy };
  await ensureWasd(hand, false);
  out.pass = Boolean(out.stick.moved && out.stickSteady.pass && out.wasd.moved);
  return out;
}

async function test1351(hand, prefix) {
  const out = {};
  await ensurePort(hand, 1);
  await ensureMouse(hand, true);
  out.opts = await hand.page.evaluate(() => window.__g64?.runtimeViceOpts?.() ?? null);
  out.settings = await hand.page.evaluate(() => window.__g64?.settings?.() ?? null);
  const pad = hand.page.locator(".g64-touchpad").first();
  const padBox = await hand.reveal(pad, "trackpad");
  const track = await pointerProbe(hand, "trackpad", () => dragBox(hand, padBox, { from: [0.15, 0.5], to: [0.85, 0.2] }));
  await savePng(hand.shotDir(), `${prefix}-trackpad-before.png`, track.b64Before);
  await savePng(hand.shotDir(), `${prefix}-trackpad-after.png`, track.b64After);
  await hand.shot(`${prefix}-trackpad.png`);
  out.trackpad = { moved: track.pass, changed: track.changed, inkDist: track.inkDist, dx: track.dx, dy: track.dy };

  const crtBox = await hand.reveal(hand.crt(), "crt");
  const drag = await pointerProbe(hand, "canvas-drag", () =>
    dragBox(hand, crtBox, { from: [0.3, 0.35], to: [0.75, 0.65], steps: 14, stepMs: 35 }),
  );
  await savePng(hand.shotDir(), `${prefix}-drag-after.png`, drag.b64After);
  await hand.shot(`${prefix}-canvas-drag.png`);
  out.drag = { moved: drag.pass, changed: drag.changed, inkDist: drag.inkDist, dx: drag.dx, dy: drag.dy };

  const left = hand.page.getByRole("button", { name: "Left mouse button" }).first();
  const click = await pointerProbe(hand, "left-click", async () => {
    await hand.click(left, "1351 left");
    await sleep(80);
  }, { settle: 350 });
  await savePng(hand.shotDir(), `${prefix}-click-after.png`, click.b64After);
  await hand.shot(`${prefix}-left-click.png`);
  out.click = { changed: click.changed, inkDist: click.inkDist, pass: click.changed >= 20 || click.inkDist >= 1.2 };

  const nudge = await pointerProbe(hand, "nudge", async () => {
    await hand.page.evaluate(() => window.__g64?.addMouseDelta?.(90, 36));
    await sleep(120);
    await hand.page.evaluate(() => window.__g64?.addMouseDelta?.(90, 36));
  }, { settle: 400 });
  await savePng(hand.shotDir(), `${prefix}-nudge-after.png`, nudge.b64After);
  out.nudge = { moved: nudge.pass, changed: nudge.changed, inkDist: nudge.inkDist, dx: nudge.dx, dy: nudge.dy };

  out.pass = Boolean(out.trackpad.moved || out.drag.moved || out.nudge.moved);
  out.clickPass = Boolean(out.click.pass);
  return out;
}

/** Page the official deskTop notepad and double-click COMM 1351(a). */
async function activateGeos1351(hand) {
  const out = { steps: [] };
  await ensureMouse(hand, false);
  await ensurePort(hand, 1);
  await ensureWasd(hand, false);
  const before = await snapshot(hand.page);
  await savePng(hand.shotDir(), "10-1351-before.png", before.b64);
  await holdJoy(hand, 0, -1, 2200);
  out.steps.push("up");
  await holdJoy(hand, -1, 0, 2200);
  out.steps.push("left");
  await holdJoy(hand, 1, 0, 1100);
  out.steps.push("page-x");
  await clickJoy(hand);
  await sleep(350);
  await hand.shot("10-1351-page-menu.png");
  out.steps.push("page-click");
  await holdJoy(hand, 0, 1, 240);
  await clickJoy(hand);
  await sleep(900);
  const page2 = await snapshot(hand.page);
  await savePng(hand.shotDir(), "10-1351-page2.png", page2.b64);
  await hand.shot("10-1351-page2-ui.png");
  out.paged = movedEnough(before, page2, { minChanged: 80, minInk: 4 });
  out.steps.push("page-next");
  await holdJoy(hand, 1, 0, 1800);
  await holdJoy(hand, 0, 1, 1400);
  await clickJoy(hand, { double: true });
  await sleep(2800);
  const after = await snapshot(hand.page);
  await savePng(hand.shotDir(), "10-1351-after.png", after.b64);
  await hand.shot("10-1351-after-ui.png");
  out.after = movedEnough(page2, after, { minChanged: 20, minInk: 1.5 });
  out.steps.push("comm-open");
  out.pass = Boolean(out.paged.pass || out.after.pass);
  return out;
}

async function bootOfficialGeos(hand, disk) {
  await hand.clickCrtAndType('LOAD"BOOT",8,1');
  const loadLine = await hand.waitTypedLine('LOAD"BOOT",8,1');
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
  await sleep(1500);
  const snap = await snapshot(hand.page);
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
  trace.geos = await bootOfficialGeos(hand, disk);
  trace.deskTop = Boolean(trace.geos.desk?.pass || trace.geos.boot?.deskTop?.pass);
  if (trace.deskTop) {
    trace.joystick = await testStickAndWasd(hand, "08");
    trace.comm1351 = await activateGeos1351(hand);
    trace.mouse = await test1351(hand, "09");
  }
  trace.pass = Boolean(
    trace.jiffyOk &&
      trace.insertLeftReady &&
      trace.kbjoy?.pass &&
      trace.deskTop &&
      trace.joystick?.pass &&
      trace.mouse?.pass,
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
  const already = await hand.page.evaluate(() => {
    const t = window.__g64?.title?.() ?? "";
    return Boolean(window.__g64?.running?.() && !window.__g64?.booting?.() && /GUI64|\.crt/i.test(t));
  });
  if (!already) await playFromLibrary(hand, cart, "01-play");
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
    trace.joystick = await testStickAndWasd(hand, "03");
    trace.mouse = await test1351(hand, "04");
  }
  const wantStd = /PAL/i.test(cart.name) ? "pal" : "ntsc";
  trace.videoOk = trace.video?.resolved === wantStd || trace.video?.software === wantStd;
  trace.pass = Boolean(trace.started && trace.gui.pass && trace.joystick?.pass && trace.mouse?.pass);
  return trace;
}

async function main() {
  for (const [k, p] of Object.entries(files)) {
    if (!existsSync(p)) {
      console.log(JSON.stringify({ pass: false, skipped: true, reason: `missing ${k}`, path: p }, null, 2));
      process.exit(0);
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

  run.pass = Boolean(
    (run.geos.jiffyOff?.pass ?? !modes.includes(false)) &&
      (run.geos.jiffyOn?.pass ?? !modes.includes(true)) &&
      run.gui64.ntsc?.pass &&
      run.gui64.pal?.pass,
  );
  writeRun(run);
  console.log(JSON.stringify(run, null, 2));
  process.exit(run.pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
