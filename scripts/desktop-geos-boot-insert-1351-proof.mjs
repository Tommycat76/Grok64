#!/usr/bin/env node
/**
 * Headless proof for the two f61198f regressions:
 *   1) Insert official GEOS Boot Disk.d64 on unit 8 with Tom's 1541@8 + CMD HD@9 map
 *      must attach (rc 0, not -99) and LOAD"BOOT",8,1 must not FILE NOT FOUND.
 *   2) 1351 stays the VICE mouse_move path; host drag is 1 CSS px = 1 count
 *      (the CRT-scale shrink rounded small drags to 0 while WASD still moved).
 *
 *   GROK64_FIX_MEDIA=/tmp/g64media/g64media node scripts/desktop-geos-boot-insert-1351-proof.mjs
 *
 * Never copies private media into the workspace.
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  assertGrok64WasmCore,
  clearEmulatorJsCache,
  grok64DatapathFromEnv,
  installGrok64CoreNetworkGuard,
} from "./desktop-grok64-core.mjs";
import {
  patchLocalStorage,
  seedTomReusedProfile,
  powerOnDesktop,
  typeC64RealKeyboard,
  waitForG64,
  waitRunning,
} from "./desktop-qa-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const mediaRoot = resolve(process.env.GROK64_FIX_MEDIA || "/tmp/g64media/g64media");
const d64Path = join(mediaRoot, "GEOS Boot Disk.d64");
const shotDir = join(process.cwd(), "screenshots", "geos-boot-insert-1351");
const outDir = join(process.cwd(), "artifacts", "geos-boot-insert-1351");
mkdirSync(shotDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

if (!grok64DatapathFromEnv() || !existsSync(d64Path)) {
  console.log(JSON.stringify({ pass: false, skipped: true, reason: "no-media-or-datapath" }));
  process.exit(1);
}

const d64Name = basename(d64Path);
const d64Bytes = readFileSync(d64Path);
if (d64Bytes.byteLength !== 174848) {
  console.log(JSON.stringify({ pass: false, reason: "wrong-geos-boot-bytes", bytes: d64Bytes.byteLength }));
  process.exit(1);
}
const d64B64 = d64Bytes.toString("base64");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e?.message || e)));
const shot = (name) => page.screenshot({ path: join(shotDir, name), fullPage: true });
const run = { d64Name, bytes: d64Bytes.byteLength };
await installGrok64CoreNetworkGuard(page, base);

try {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await clearEmulatorJsCache(page);
  await seedTomReusedProfile(page, { jiffyDos: false, mouseMode: true });
  await patchLocalStorage(page, {
    video: "auto",
    jiffy: false,
    reu: "2048kB",
    drive: "cmd-layout",
    machineId: "c64-auto",
    coreMode: "auto",
    driveMode: "auto",
    mouse: true,
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForG64(page);
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
  await assertGrok64WasmCore(page, { timeoutMs: 120_000 });
  run.iecMap = await page.evaluate(() => window.__g64?.iecMap?.());
  run.user = await page.evaluate(() => ({
    iec: window.__g64?.userIec?.(),
    unit: window.__g64?.userUnit?.(),
    mouse: window.__g64?.settings?.()?.mouseMode,
    joyPort: window.__g64?.joyPort?.(),
  }));
  if (run.iecMap?.[8] !== "1541" || run.iecMap?.[9] !== "cmdhd") {
    throw new Error(`Tom IEC map not applied: ${JSON.stringify(run.iecMap)}`);
  }
  await shot("00-powered.png");

  await page.evaluate(
    async ({ name, b64 }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await window.__g64?.importLibraryBytes?.(name, bin);
    },
    { name: d64Name, b64: d64B64 },
  );
  await page.waitForTimeout(400);

  await page.locator('button[aria-label="Software"]').first().click({ timeout: 15_000, force: true });
  await page.evaluate(() => window.__g64?.openSoftwareLibrary?.());
  await page.locator(".g64-seg button").filter({ hasText: /^On this device/ }).click({ force: true }).catch(() => {});
  await page.locator(".g64-sheet").waitFor({ state: "visible", timeout: 15_000 });
  const card = page.locator(".g64-card").filter({ hasText: d64Name }).first();
  await card.waitFor({ state: "visible", timeout: 30_000 });
  await card.scrollIntoViewIfNeeded();
  await card.getByRole("group", { name: /IEC drive unit/i }).getByRole("button", { name: "8", exact: true }).click({
    force: true,
    timeout: 15_000,
  });
  await page.waitForTimeout(250);
  await shot("01-library.png");
  const insertBtn = page.getByRole("button", { name: `Insert ${d64Name}` });
  await insertBtn.click({ timeout: 60_000, force: true });
  await waitRunning(page, 180_000);
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.__g64?.closeUiSheets?.());
  await shot("02-after-insert.png");

  const diag = await page.evaluate(async () => {
    const d = await window.__g64?.attachDiskDiag?.();
    const opts = window.__g64?.opts?.() ?? {};
    const live8 = window.__g64?.viceDriveLive?.(8);
    const live9 = window.__g64?.viceDriveLive?.(9);
    return {
      viceLastReattach: d?.viceLastReattach ?? null,
      viceAttachedImage: d?.viceAttachedImage ?? null,
      drive8Type: opts.vice_drive8_type ?? d?.drive8Type ?? null,
      drive9Type: opts.vice_drive9_type ?? null,
      live8Type: live8?.wasmDriveUnitType ?? null,
      live9Type: live9?.wasmDriveUnitType ?? null,
      session: d?.session ?? null,
      toastish: document.body.innerText.includes("VICE disk reattach failed"),
    };
  });
  run.diag = diag;
  const attachRc = diag.viceLastReattach?.rc;
  run.attachOk = attachRc === 0 && !diag.toastish && attachRc !== -99;
  if (!run.attachOk) {
    throw new Error(`insert attach failed rc=${attachRc} toast=${diag.toastish}`);
  }
  if (diag.drive8Type && /cmd/i.test(String(diag.drive8Type))) {
    throw new Error(`drive 8 became ${diag.drive8Type} — floppy insert must stay 1541`);
  }
  if (diag.live8Type != null && diag.live8Type !== 1541 && diag.live8Type !== 1542 && diag.live8Type !== 0) {
    throw new Error(`live Drive8Type=${diag.live8Type}, expected a 1541`);
  }

  await typeC64RealKeyboard(page, 'LOAD"BOOT",8,1', { keyDelayMs: 90, lineEndMs: 1200 });
  const loadT0 = Date.now();
  let screen = "";
  let sawBoot = false;
  let fileNotFound = false;
  while (Date.now() - loadT0 < 120_000) {
    await page.waitForTimeout(1000);
    screen = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
    if (/FILE NOT FOUND|\?FILE/i.test(screen)) {
      fileNotFound = true;
      break;
    }
    if (/SEARCHING FOR BOOT|LOADING|BOOTING GEOS|READY\./i.test(screen)) sawBoot = true;
    if (sawBoot && /READY\.|BOOTING GEOS/i.test(screen) && !/SEARCHING FOR/i.test(screen)) break;
    if (sawBoot && /LOADING/i.test(screen) && Date.now() - loadT0 > 8_000) break;
  }
  run.loadMs = Date.now() - loadT0;
  run.screen = screen.slice(0, 700);
  run.sawBoot = sawBoot;
  await shot("03-load-boot.png");
  run.fileNotFound = fileNotFound;
  if (fileNotFound || !sawBoot) {
    throw new Error(`LOAD"BOOT",8,1 failed fnf=${fileNotFound} sawBoot=${sawBoot}: ${screen.slice(0, 220)}`);
  }

  await page.evaluate(() => {
    window.__g64?.setMouseMode?.(true);
    window.__g64?.setJoyPort?.(1);
  });
  await page.waitForTimeout(400);
  const mouse = await page.evaluate(() => {
    const wide = window.__g64?.hostDragTo1351?.(3, 2, 768, 544);
    const native = window.__g64?.hostDragTo1351?.(12, -8, 384, 272);
    window.__g64?.addHostDrag?.(3, 2);
    const opts = window.__g64?.opts?.() ?? {};
    return {
      direct: window.__g64?.vice1351Direct?.(),
      joyPort: window.__g64?.joyPort?.(),
      mouseMode: window.__g64?.settings?.()?.mouseMode,
      wide,
      native,
      joyport: opts.vice_joyport ?? null,
      joyportType: opts.vice_joyport_type ?? null,
    };
  });
  const screenBox = page.locator(".g64-screen").first();
  const box = await screenBox.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.4 + 6, box.y + box.height * 0.4 + 5, { steps: 4 });
    await page.mouse.up();
  }
  await page.waitForTimeout(200);
  run.mouse = mouse;
  run.pageErrors = errors;
  run.dragIdentity = mouse.wide?.dx === 3 && mouse.wide?.dy === 2 && mouse.native?.dx === 12 && mouse.native?.dy === -8;
  run.mouseOk =
    mouse.direct === true &&
    mouse.joyPort === 1 &&
    mouse.mouseMode === true &&
    run.dragIdentity &&
    errors.length === 0;
  if (!run.mouseOk) {
    throw new Error(`1351 path failed: ${JSON.stringify(mouse)} errors=${errors.join(" | ")}`);
  }
  await shot("04-mouse.png");

  run.pass = true;
  writeFileSync(join(outDir, "results.json"), JSON.stringify(run, null, 2));
  console.log(JSON.stringify({ pass: true, attachRc, drive8Type: diag.drive8Type, live8Type: diag.live8Type, mouse }, null, 2));
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
