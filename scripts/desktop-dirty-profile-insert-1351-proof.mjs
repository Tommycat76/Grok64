#!/usr/bin/env node
/**
 * Dirty-profile proof for the 1bac0e2 regressions:
 *   1) Software Insert and Load Disk Insert of official GEOS Boot Disk.d64
 *      after CART OUT, with saved CMD HD @9, a 1581, prior imports, and a
 *      cart that was inserted then pulled. Must not toast rc=-99; drive 8
 *      must not stay WORK DISK.
 *   2) 1351: host cursor hidden, CRT-scale motion, left-button click flush.
 *   3) Fresh profile defaults WASD joystick off; a saved on-state persists.
 *
 *   GROK64_FIX_MEDIA=/tmp/g64media/g64media node scripts/desktop-dirty-profile-insert-1351-proof.mjs
 *
 * Never copies private media into the workspace. Does not clear the EJS
 * cache after the first boot — CART OUT is the dirty Module leftover.
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { grok64DatapathFromEnv, installGrok64CoreNetworkGuard } from "./desktop-grok64-core.mjs";
import {
  patchLocalStorage,
  seedTomReusedProfile,
  powerOnDesktop,
  typeC64RealKeyboard,
  waitForG64,
  waitRunning,
} from "./desktop-qa-lib.mjs";
import { geosD64Fingerprint } from "./geos-fixture-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const mediaRoot = resolve(process.env.GROK64_FIX_MEDIA || "/tmp/g64media/g64media");
const d64Path = join(mediaRoot, "GEOS Boot Disk.d64");
const crtPath = join(mediaRoot, "GUI64 [NTSC].crt");
const shotDir = join(process.cwd(), "screenshots", "dirty-profile-insert-1351");
const outDir = join(process.cwd(), "artifacts", "dirty-profile-insert-1351");
mkdirSync(shotDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

if (!grok64DatapathFromEnv() || !existsSync(d64Path) || !existsSync(crtPath)) {
  console.log(JSON.stringify({ pass: false, skipped: true, reason: "no-media-or-datapath" }));
  process.exit(1);
}

const d64Name = basename(d64Path);
const crtName = basename(crtPath);
const d64Bytes = readFileSync(d64Path);
const crtBytes = readFileSync(crtPath);
if (d64Bytes.byteLength !== 174848) {
  console.log(JSON.stringify({ pass: false, reason: "wrong-geos-boot-bytes", bytes: d64Bytes.byteLength }));
  process.exit(1);
}
const d64Bam = geosD64Fingerprint(d64Bytes).bamName ?? "";
const d64B64 = d64Bytes.toString("base64");
const crtB64 = crtBytes.toString("base64");
const reuB64 = Buffer.alloc(131072).toString("base64");

const toastTexts = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-sonner-toast]"), (t) => t.textContent?.trim() ?? ""),
  );

const chromeBin =
  process.env.CHROME_PATH || (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);

async function launchPage() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromeBin,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader-webgl"],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => {
    const msg = String(e?.message || e);
    if (/Hydration failed/i.test(msg)) return;
    errors.push(msg);
  });
  await installGrok64CoreNetworkGuard(page, base);
  return { browser, page, errors };
}

async function importBytes(page, name, b64) {
  await page.evaluate(
    async ({ name, b64 }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await window.__g64?.importLibraryBytes?.(name, bin);
    },
    { name, b64 },
  );
}

async function openOnDevice(page) {
  await page.locator('button[aria-label="Software"]').first().click({ timeout: 15_000 });
  await page.locator(".g64-seg button").filter({ hasText: /^On this device/ }).click().catch(() => {});
  await page.locator(".g64-sheet").waitFor({ state: "visible", timeout: 15_000 });
}

async function insertLibraryDisk(page, name) {
  await openOnDevice(page);
  const card = page.locator(".g64-card").filter({ hasText: name }).first();
  await card.waitFor({ state: "visible", timeout: 30_000 });
  await card.scrollIntoViewIfNeeded();
  const unit8 = card.getByRole("group", { name: /IEC drive unit/i }).getByRole("button", { name: "8", exact: true });
  if (await unit8.count()) await unit8.click({ timeout: 15_000 });
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: `Insert ${name}` }).click({ timeout: 60_000 });
}

async function waitInsertOutcome(page, ms = 90_000) {
  const t0 = Date.now();
  let toasts = [];
  while (Date.now() - t0 < ms) {
    toasts = await toastTexts(page);
    const fail = toasts.find((t) => /VICE disk reattach failed/i.test(t));
    const ok = toasts.find((t) => /^Inserted .+ on drive 8$/.test(t));
    if (fail || ok) return { toasts, fail: fail ?? null, ok: Boolean(ok) };
    await page.waitForTimeout(250);
  }
  return { toasts, fail: null, ok: false };
}

const run = { d64Name, crtName, d64Bam, bytes: d64Bytes.byteLength };

const fresh = await launchPage();
try {
  await fresh.page.goto(base, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitForG64(fresh.page);
  const wasdFresh = await fresh.page.evaluate(() => window.__g64?.settings?.()?.wasdIsJoy);
  run.wasdFresh = wasdFresh;
  if (wasdFresh !== false) throw new Error(`fresh profile WASD default is ${wasdFresh}, want false`);
} finally {
  await fresh.browser.close();
}

const { browser, page, errors } = await launchPage();
const shot = (name) => page.screenshot({ path: join(shotDir, name), fullPage: true });

try {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await seedTomReusedProfile(page, {
    jiffyDos: false,
    mouseMode: true,
    wasdIsJoy: true,
    iecMap: { 8: "1541", 9: "cmdhd", 10: "1581", 11: "none" },
    iecDrive: "cmdhd",
    iecUnit: 9,
  });
  await patchLocalStorage(page, {
    video: "auto",
    jiffy: false,
    reu: "2048kB",
    drive: "cmd-layout",
    machineId: "c64-auto",
    coreMode: "auto",
    driveMode: "auto",
    mouse: true,
    joy: 1,
  });
  await page.evaluate(() => {
    const key = "grok64-settings";
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const data = JSON.parse(raw);
    data.state.wasdIsJoy = true;
    data.state.iecMap = { 8: "1541", 9: "cmdhd", 10: "1581", 11: "none" };
    data.state.iecDrive = "cmdhd";
    data.state.iecUnit = 9;
    localStorage.setItem(key, JSON.stringify(data));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForG64(page);
  await importBytes(page, d64Name, d64B64);
  await importBytes(page, crtName, crtB64);
  await importBytes(page, "Prior.reu", reuB64);
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
  run.iecMap = await page.evaluate(() => window.__g64?.iecMap?.());
  run.wasdDirtyLoad = await page.evaluate(() => window.__g64?.settings?.()?.wasdIsJoy);
  if (run.iecMap?.[8] !== "1541" || run.iecMap?.[9] !== "cmdhd" || run.iecMap?.[10] !== "1581") {
    throw new Error(`dirty IEC map not applied: ${JSON.stringify(run.iecMap)}`);
  }
  if (run.wasdDirtyLoad !== true) throw new Error(`saved WASD-on did not persist: ${run.wasdDirtyLoad}`);
  await shot("00-dirty-powered.png");

  await openOnDevice(page);
  await page.getByRole("button", { name: `Play ${crtName}` }).click({ timeout: 60_000 });
  await waitRunning(page, 180_000);
  await page.waitForTimeout(4000);
  run.cartLive = await page.evaluate(() => window.__g64?.cartLive?.());
  await shot("01-gui64-cart.png");

  const mouseChip = page.locator(".g64-chip-gate").filter({ hasText: /^MOUSE$/ }).first();
  await mouseChip.waitFor({ state: "visible", timeout: 15_000 });
  if ((await mouseChip.getAttribute("data-on")) !== "true") {
    await mouseChip.click();
    await page.waitForTimeout(250);
  }
  const portBtn = page.getByRole("button", { name: /Joystick port/ });
  if (await portBtn.count()) {
    for (let i = 0; i < 2; i++) {
      const label = await portBtn.first().innerText();
      if (/P1/.test(label)) break;
      await portBtn.first().click();
      await page.waitForTimeout(200);
    }
  }
  const cursor = await page.evaluate(() => getComputedStyle(document.querySelector(".g64-screen")).cursor);
  run.mouseCursor = cursor;
  if (cursor !== "none") throw new Error(`MOUSE-on glass cursor is ${cursor}, want none`);
  const screenBox = page.locator(".g64-screen").first();
  const box = await screenBox.boundingBox();
  if (!box) throw new Error("CRT glass has no box");
  const scale = await page.evaluate(
    ({ w, h }) => window.__g64?.hostDragTo1351?.(20, 20, w, h),
    { w: box.width, h: box.height },
  );
  run.mouseScale = { box, scale };
  if (!scale || Math.abs(scale.dx - 20 * (384 / box.width)) > 0.05) {
    throw new Error(`1351 scale is not CRT-relative: ${JSON.stringify(scale)} glass=${box.width}`);
  }
  const feed0 = await page.evaluate(() => window.__g64?.realMouseFeed?.());
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35);
  await page.mouse.move(box.x + box.width * 0.35 + 48, box.y + box.height * 0.35 + 32, { steps: 14 });
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(80);
  const feed1 = await page.evaluate(() => window.__g64?.realMouseFeed?.());
  run.mouseFeed = { feed0, feed1 };
  if ((feed1?.moves ?? 0) <= (feed0?.moves ?? 0)) {
    throw new Error(`real pointer did not feed 1351: ${JSON.stringify(run.mouseFeed)}`);
  }
  await shot("02-gui64-mouse.png");

  await page.locator('[data-hw="cart-out"]').click({ timeout: 15_000 });
  await waitRunning(page, 180_000);
  await page.waitForTimeout(2500);
  run.afterCartOut = await page.evaluate(() => ({
    title: window.__g64?.title?.(),
    cartLive: window.__g64?.cartLive?.(),
    attached: window.__g64?.viceAttachedImage?.(8),
    screen: (window.__g64?.screenText?.() ?? "").slice(0, 240),
  }));
  await shot("03-cart-out.png");

  await insertLibraryDisk(page, d64Name);
  const software = await waitInsertOutcome(page);
  run.softwareInsert = software;
  if (software.fail) throw new Error(`Software Insert toasted ${software.fail}`);
  if (!software.ok) throw new Error(`Software Insert did not toast success: ${JSON.stringify(software.toasts)}`);
  await page.evaluate(() => window.__g64?.closeUiSheets?.());
  await page.waitForTimeout(800);
  const softwareDiag = await page.evaluate(async () => {
    const d = await window.__g64?.attachDiskDiag?.({ light: true });
    return {
      last: d?.viceLastReattach ?? window.__g64?.lastDiskAttach?.(8) ?? null,
      attached: d?.viceAttachedImage ?? null,
      live: window.__g64?.viceDriveLive?.(8) ?? null,
      bindRev: d?.grok64WasmBindRev ?? null,
      viceDiag: d?.viceLastAttachDiag ?? window.__g64?.lastDiskAttachDiag?.() ?? null,
    };
  });
  run.softwareDiag = softwareDiag;
  if (softwareDiag.last?.rc !== 0 || softwareDiag.last?.rc === -99) {
    throw new Error(`Software Insert attach rc=${softwareDiag.last?.rc} last=${JSON.stringify(softwareDiag.last)}`);
  }
  const bam = softwareDiag.live?.wasmBamLabel ?? softwareDiag.live?.fsPathLabel ?? "";
  run.softwareBam = bam;
  if (/work\s*disk/i.test(bam) || /work\s*disk/i.test(String(softwareDiag.attached ?? ""))) {
    throw new Error(`drive 8 still WORK DISK after Insert: bam=${bam} attached=${softwareDiag.attached}`);
  }
  await shot("04-software-insert.png");

  // Saved WASD-on eats A/D in LOAD"$",8 — turn it off through the chip first.
  const wasdChip = page.locator(".g64-chip-gate").filter({ hasText: /^WASD$/ }).first();
  if ((await wasdChip.getAttribute("data-on")) === "true") {
    await wasdChip.click();
    await page.waitForTimeout(250);
  }
  run.wasdBeforeType = await page.evaluate(() => window.__g64?.settings?.()?.wasdIsJoy);
  if (run.wasdBeforeType !== false) throw new Error(`WASD still on before LOAD$: ${run.wasdBeforeType}`);

  await typeC64RealKeyboard(page, 'LOAD"$",8', { keyDelayMs: 90, lineEndMs: 1200 });
  const loadT0 = Date.now();
  let dollarScreen = "";
  let loadedDir = false;
  while (Date.now() - loadT0 < 90_000) {
    await page.waitForTimeout(1000);
    dollarScreen = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
    if (/FILE NOT FOUND|\?FILE|DEVICE NOT PRESENT/i.test(dollarScreen)) break;
    if (/LOAD"\$",8/i.test(dollarScreen) && /LOADING/i.test(dollarScreen) && /READY/i.test(dollarScreen)) {
      loadedDir = true;
      break;
    }
  }
  if (loadedDir) {
    await typeC64RealKeyboard(page, "LIST", { keyDelayMs: 90, lineEndMs: 1500 });
    const listT0 = Date.now();
    while (Date.now() - listT0 < 45_000) {
      await page.waitForTimeout(800);
      dollarScreen = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
      if (/(BOOT|GEOS|COMM 1351|BLOCKS FREE|WORK\s*DISK)/i.test(dollarScreen)) break;
    }
  }
  const sawCatalog = /(BOOT|GEOS|COMM 1351)/i.test(dollarScreen);
  const sawWorkDisk = /WORK\s*DISK/i.test(dollarScreen);
  run.dollar = { screen: dollarScreen.slice(0, 900), sawCatalog, sawWorkDisk, loadedDir };
  await shot("05-load-dollar.png");
  if (sawWorkDisk || !sawCatalog) {
    throw new Error(`LOAD"$",8 missed GEOS catalog work=${sawWorkDisk} geos=${sawCatalog}: ${dollarScreen.slice(0, 220)}`);
  }

  await page.locator('button[aria-label="Insert disk"]').first().click({ timeout: 15_000 });
  await page.locator(".g64-sheet").waitFor({ state: "visible", timeout: 15_000 });
  const diskCard = page.locator(".g64-card").filter({ hasText: d64Name }).first();
  await diskCard.waitFor({ state: "visible", timeout: 15_000 });
  const loadUnit = await diskCard.getByRole("group", { name: /IEC drive unit/i }).locator("button[data-on='true']").innerText().catch(() => "");
  run.loadDiskDefaultUnit = loadUnit.trim();
  if (run.loadDiskDefaultUnit === "9") {
    throw new Error("Load Disk sheet defaulted to unit 9 (CMD HD) for a D64");
  }
  await diskCard.getByRole("group", { name: /IEC drive unit/i }).getByRole("button", { name: "8", exact: true }).click({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: `Insert ${d64Name}` }).click({ timeout: 60_000 });
  const loadDisk = await waitInsertOutcome(page);
  run.loadDiskInsert = loadDisk;
  if (loadDisk.fail) throw new Error(`Load Disk Insert toasted ${loadDisk.fail}`);
  if (!loadDisk.ok) throw new Error(`Load Disk Insert did not toast success: ${JSON.stringify(loadDisk.toasts)}`);
  await page.evaluate(() => window.__g64?.closeUiSheets?.());
  await shot("06-load-disk-insert.png");

  run.pageErrors = errors;
  run.pass = errors.length === 0;
  if (!run.pass) throw new Error(errors.join(" | "));
  writeFileSync(join(outDir, "results.json"), JSON.stringify(run, null, 2));
  console.log(
    JSON.stringify(
      {
        pass: true,
        wasdFresh: run.wasdFresh,
        wasdDirtyLoad: run.wasdDirtyLoad,
        attachRc: softwareDiag.last?.rc,
        path: softwareDiag.last?.path,
        vice: softwareDiag.last?.viceDiag ?? softwareDiag.viceDiag,
        bindRev: softwareDiag.bindRev,
        bam,
        mouseCursor: run.mouseCursor,
        scale: run.mouseScale?.scale,
      },
      null,
      2,
    ),
  );
  process.exit(0);
} catch (e) {
  run.pass = false;
  run.error = String(e?.message || e);
  run.pageErrors = errors;
  writeFileSync(join(outDir, "results.json"), JSON.stringify(run, null, 2));
  await shot("fail.png").catch(() => {});
  console.error(JSON.stringify(run, null, 2));
  process.exit(1);
} finally {
  await browser.close();
}
