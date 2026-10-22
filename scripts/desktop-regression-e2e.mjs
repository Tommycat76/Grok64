#!/usr/bin/env node
/**
 * Full desktop UI regression (Chromium). See docs/TESTING.md checklist.
 *   npm run test:desktop-regression
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import {
  canvasHasSignal,
  noPowerSplash,
  openSoftware,
  patchLocalStorage,
  powerOnDesktop,
  waitRunning,
} from "./desktop-qa-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const outDir = join(process.cwd(), "artifacts", "desktop-regression-e2e");
mkdirSync(outDir, { recursive: true });

const results = [];
const push = (row) => {
  results.push(row);
  console.log(row.pass ? "PASS" : row.skipped ? "SKIP" : "FAIL", row.id, row.detail ?? row.reason ?? "");
};

async function openSettings(page) {
  const opened = await page.evaluate(() => {
    window.__g64?.setSettingsOpen?.(true);
    return true;
  });
  if (!opened) {
    const more = page.locator('button[aria-label="More"]');
    if (await more.isVisible().catch(() => false)) {
      await more.click({ timeout: 8000 });
      await page.waitForTimeout(200);
    }
    await page.locator('button[aria-label="Settings"]').click({ timeout: 8000 });
  }
  await page.locator(".g64-sheet h2", { hasText: "Machine" }).waitFor({ timeout: 8000 });
}

async function reuColdBoot(page, reu) {
  await patchLocalStorage(page, { video: "pal", sid: "6581", reu, drive: "1541" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await powerOnDesktop(page, base, { navigate: false });
  const rt = await page.evaluate(() => window.__g64?.runtimeViceOpts?.() || {});
  const want = reu === "none" ? "none" : reu;
  return rt.vice_ram_expansion_unit === want;
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

try {
  await powerOnDesktop(page, base);
  push({ id: "power-boot", pass: await page.evaluate(() => window.__g64?.hasFs?.()) });

  // REU sizes (UI: Off, 256K, 512K, 2MB, 16MB — VICE has no 128K option)
  for (const reu of ["none", "256kB", "512kB", "2048kB", "16384kB"]) {
    const ok = await reuColdBoot(page, reu);
    push({ id: `reu-${reu}`, pass: ok, detail: reu });
  }

  await powerOnDesktop(page, base);
  await page.evaluate(() => window.__g64?.setShowKeyboard?.(true));
  await page.waitForTimeout(500);
  push({
    id: "keyboard-toggle",
    pass: (await page.locator(".g64-kb").count()) > 0 || (await page.evaluate(() => window.__g64?.sessionFlags?.().showKeyboard)),
  });

  await page.evaluate(() => {
    window.__g64?.swapJoy?.();
  });
  const p1 = await page.evaluate(() => window.__g64?.sessionFlags?.().joyPort);
  await page.evaluate(() => window.__g64?.swapJoy?.());
  const p2 = await page.evaluate(() => window.__g64?.sessionFlags?.().joyPort);
  push({ id: "joystick-port-swap", pass: p1 !== p2, detail: { p1, p2 } });

  await page.evaluate(() => window.__g64?.toggleWarp?.());
  const w1 = await page.evaluate(() => window.__g64?.sessionFlags?.().warped);
  await page.evaluate(() => window.__g64?.toggleWarp?.());
  const w2 = await page.evaluate(() => window.__g64?.sessionFlags?.().warped);
  push({ id: "warp-toggle", pass: w1 !== w2, detail: { w1, w2 } });

  await page.evaluate(() => window.__g64?.setMuted?.(true));
  const mu = await page.evaluate(() => window.__g64?.sessionFlags?.().muted);
  await page.evaluate(() => window.__g64?.setMuted?.(false));
  push({ id: "audio-mute", pass: mu === true });

  await page.evaluate(() => window.__g64?.setPaused?.(true));
  const pa = await page.evaluate(() => window.__g64?.sessionFlags?.().paused);
  await page.evaluate(() => window.__g64?.setPaused?.(false));
  push({ id: "pause-toggle", pass: pa === true });

  const beforeSnaps = await page.evaluate(() => window.__g64?.snapshotCount?.() ?? 0);
  await page.evaluate(() => window.__g64?.playBundled?.("byte-hopper"));
  await waitRunning(page, 35000);
  const saved = await page.evaluate(() => window.__g64?.saveFreezeSlot?.(1));
  const afterSnaps = await page.evaluate(() => window.__g64?.snapshotCount?.() ?? 0);
  push({ id: "save-state-freeze-f1", pass: saved && afterSnaps > beforeSnaps, detail: { beforeSnaps, afterSnaps } });

  await page.evaluate(() => window.__g64?.resetReady?.());
  await waitRunning(page, 20000);
  push({ id: "reset-ready", pass: await page.evaluate(() => window.__g64?.hasFs?.()) });

  await page.evaluate(() => window.__g64?.playBundled?.("ready"));
  await waitRunning(page, 20000);
  const splash = await noPowerSplash(page);
  push({ id: "power-session-alive", pass: splash });

  await page.evaluate(async () => {
    window.__g64?.resetDos?.();
    await window.__g64?.seedSd?.([
      { name: "A.D64", path: "", data: new Uint8Array(174848).fill(0).buffer },
      { name: "B.D64", path: "", data: new Uint8Array(174848).fill(1).buffer },
    ]);
    window.__g64?.setIecSlot?.(8, "sd2iec");
  });
  const swap = await page.evaluate(async () => window.__g64?.sdFreeze?.(1));
  push({ id: "sd2iec-disk-swap", pass: swap?.ok === true || swap?.index === 1, detail: swap, optional: true });

  await page.evaluate(() => window.__g64?.playBundled?.("cart"));
  await waitRunning(page, 30000);
  const fz = await page.evaluate(() => {
    window.__g64?.setCartLive?.(true);
    return window.__g64?.cartFreeze?.();
  });
  push({ id: "cart-freeze-line", pass: fz === true, optional: true });

  await openSettings(page);
  const exp = await page.locator("text=Your ROMs").count();
  push({ id: "expansion-rom-upload-panel", pass: exp > 0 });
  await page.keyboard.press("Escape");

  await page.locator(".g64-disk").click();
  await page.waitForTimeout(600);
  push({ id: "disk-mount-sheet", pass: (await page.getByRole("heading", { name: "Insert disk" }).count()) > 0 });
  await page.keyboard.press("Escape");

  await openSoftware(page);
  push({ id: "software-catalog", pass: (await page.locator(".g64-catalog").count()) > 0 });
} catch (e) {
  push({ id: "suite-error", pass: false, error: String(e) });
}

await browser.close();
const failed = results.filter((r) => !r.pass && !r.skipped && !r.optional);
writeFileSync(join(outDir, "results.json"), JSON.stringify({ results, failed: failed.length }, null, 2));
process.exit(failed.length ? 1 : 0);
