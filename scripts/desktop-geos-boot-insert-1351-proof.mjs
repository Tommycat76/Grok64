#!/usr/bin/env node
/**
 * Real-UI proof for the two 37fb8af regressions:
 *   1) Software library Insert of official GEOS Boot Disk.d64 must call
 *      grok64_disk_attach (not skip with rc=-99) and show the Inserted toast.
 *   2) The MOUSE chip plus real canvas pointer events (hover and drag) must
 *      feed the 1351. Helpers (addHostDrag / setMouseMode / insertLibraryByName)
 *      are not the proof.
 *
 *   GROK64_FIX_MEDIA=/tmp/g64media/g64media node scripts/desktop-geos-boot-insert-1351-proof.mjs
 *
 * Never copies private media into the workspace.
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { grok64DatapathFromEnv, installGrok64CoreNetworkGuard, clearEmulatorJsCache } from "./desktop-grok64-core.mjs";
import { patchLocalStorage, seedTomReusedProfile, powerOnDesktop, typeC64RealKeyboard, waitForG64, waitRunning } from "./desktop-qa-lib.mjs";

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

const toastTexts = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-sonner-toast]"), (t) => t.textContent?.trim() ?? ""),
  );

const chromeBin =
  process.env.CHROME_PATH || (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);
const browser = await chromium.launch({
  headless: true,
  executablePath: chromeBin,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader-webgl"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => {
  const msg = String(e?.message || e);
  if (/Hydration failed/i.test(msg)) return;
  errors.push(msg);
});
const shot = (name) => page.screenshot({ path: join(shotDir, name), fullPage: true });
const run = { d64Name, bytes: d64Bytes.byteLength };
await installGrok64CoreNetworkGuard(page, base);

try {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await clearEmulatorJsCache(page);
  await seedTomReusedProfile(page, { jiffyDos: false, mouseMode: false });
  await patchLocalStorage(page, {
    video: "auto",
    jiffy: false,
    reu: "2048kB",
    drive: "cmd-layout",
    machineId: "c64-auto",
    coreMode: "auto",
    driveMode: "auto",
    mouse: false,
    joy: 2,
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForG64(page);
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
  // Do not call assertGrok64WasmCore here — that helper binds exports and hid
  // the Insert-path rc=-99 on 37fb8af.
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

  await page.locator('button[aria-label="Software"]').first().click({ timeout: 15_000 });
  await page.locator(".g64-seg button").filter({ hasText: /^On this device/ }).click().catch(() => {});
  await page.locator(".g64-sheet").waitFor({ state: "visible", timeout: 15_000 });
  const card = page.locator(".g64-card").filter({ hasText: d64Name }).first();
  await card.waitFor({ state: "visible", timeout: 30_000 });
  await card.scrollIntoViewIfNeeded();
  await card.getByRole("group", { name: /IEC drive unit/i }).getByRole("button", { name: "8", exact: true }).click({
    timeout: 15_000,
  });
  await page.waitForTimeout(250);
  await shot("01-library.png");
  const insertBtn = page.getByRole("button", { name: `Insert ${d64Name}` });
  await insertBtn.click({ timeout: 60_000 });

  const insertT0 = Date.now();
  let toasts = [];
  let inserted = false;
  let reattachFail = null;
  while (Date.now() - insertT0 < 90_000) {
    toasts = await toastTexts(page);
    reattachFail = toasts.find((t) => /VICE disk reattach failed/i.test(t)) ?? null;
    inserted = toasts.some((t) => /^Inserted .+ on drive 8$/.test(t));
    if (reattachFail || inserted) break;
    await page.waitForTimeout(250);
  }
  run.insertToasts = toasts;
  run.insertMs = Date.now() - insertT0;
  if (reattachFail) {
    throw new Error(`Software Insert toasted ${reattachFail}`);
  }
  if (!inserted) {
    throw new Error(`Software Insert did not toast success: ${JSON.stringify(toasts)}`);
  }
  await page.evaluate(() => window.__g64?.closeUiSheets?.());
  await page.waitForTimeout(800);
  await shot("02-after-insert.png");

  const diag = await page.evaluate(async () => {
    const d = await window.__g64?.attachDiskDiag?.({ light: true });
    const opts = window.__g64?.opts?.() ?? {};
    return {
      viceLastReattach: d?.viceLastReattach ?? null,
      viceAttachedImage: d?.viceAttachedImage ?? null,
      drive8Type: opts.vice_drive8_type ?? d?.drive8Type ?? null,
      bindRev: d?.grok64WasmBindRev ?? null,
      diskExports: d?.viceDiskExports ?? d?.diskExportsPresent ?? null,
    };
  });
  run.diag = diag;
  const attachRc = diag.viceLastReattach?.rc;
  run.attachOk = attachRc === 0 && attachRc !== -99 && Boolean(diag.viceLastReattach?.path);
  if (!run.attachOk) {
    throw new Error(`insert attach failed rc=${attachRc} last=${JSON.stringify(diag.viceLastReattach)}`);
  }
  if (diag.drive8Type && /cmd/i.test(String(diag.drive8Type))) {
    throw new Error(`drive 8 became ${diag.drive8Type} — floppy insert must stay 1541`);
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

  const mouseChip = page.locator(".g64-chip-gate").filter({ hasText: /^MOUSE$/ }).first();
  await mouseChip.waitFor({ state: "visible", timeout: 15_000 });
  const mouseBefore = await mouseChip.getAttribute("data-on");
  if (mouseBefore === "true") {
    await mouseChip.click();
    await page.waitForTimeout(200);
  }
  await mouseChip.click();
  await page.waitForTimeout(300);
  const mouseOn = await mouseChip.getAttribute("data-on");
  const appMouse = await page.locator(".g64-app").getAttribute("data-mouse");
  if (mouseOn !== "true" || appMouse !== "true") {
    throw new Error(`MOUSE chip did not turn on (chip=${mouseOn} app=${appMouse})`);
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
  run.mouseUi = await page.evaluate(() => ({
    chip: document.querySelector('.g64-chip-gate[aria-label="1351 mouse"]')?.getAttribute("data-on") ?? null,
    app: document.querySelector(".g64-app")?.getAttribute("data-mouse") ?? null,
    settings: window.__g64?.settings?.()?.mouseMode,
    joyPort: window.__g64?.joyPort?.(),
    direct: window.__g64?.vice1351Direct?.(),
  }));
  if (run.mouseUi.settings !== true || run.mouseUi.joyPort !== 1) {
    throw new Error(`MOUSE/P1 not live: ${JSON.stringify(run.mouseUi)}`);
  }

  const screenBox = page.locator(".g64-screen").first();
  const box = await screenBox.boundingBox();
  if (!box) throw new Error("CRT glass has no box");
  const feed0 = await page.evaluate(() => window.__g64?.realMouseFeed?.());
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.move(box.x + box.width * 0.3 + 40, box.y + box.height * 0.3 + 28, { steps: 12 });
  await page.waitForTimeout(80);
  const hoverFeed = await page.evaluate(() => window.__g64?.realMouseFeed?.());
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45 + 36, box.y + box.height * 0.4 + 24, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  const dragFeed = await page.evaluate(() => window.__g64?.realMouseFeed?.());
  run.pointer = { feed0, hoverFeed, dragFeed, box };
  run.hoverOk = (hoverFeed?.hoverMoves ?? 0) > (feed0?.hoverMoves ?? 0) && (hoverFeed?.moves ?? 0) > (feed0?.moves ?? 0);
  run.dragOk = (dragFeed?.dragMoves ?? 0) > (hoverFeed?.dragMoves ?? 0);
  if (!run.hoverOk || !run.dragOk) {
    throw new Error(`real pointer events did not feed 1351: ${JSON.stringify(run.pointer)}`);
  }
  await shot("04-mouse.png");

  run.pageErrors = errors;
  run.pass = errors.length === 0;
  if (!run.pass) throw new Error(errors.join(" | "));
  writeFileSync(join(outDir, "results.json"), JSON.stringify(run, null, 2));
  console.log(
    JSON.stringify(
      {
        pass: true,
        attachRc,
        path: diag.viceLastReattach?.path,
        bindRev: diag.bindRev,
        mouseUi: run.mouseUi,
        hoverMoves: hoverFeed?.hoverMoves,
        dragMoves: dragFeed?.dragMoves,
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
