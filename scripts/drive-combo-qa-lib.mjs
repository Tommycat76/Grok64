/**
 * Shared Playwright helpers for drive-combo matrix (see docs/DRIVE_COMBO_MATRIX.md).
 */
import { typeBasic, typeC64Screen, waitForDollarLoad, waitRunning } from "./desktop-qa-lib.mjs";

export function synthJiffyPair() {
  const c64 = new Uint8Array(8192);
  const d41 = new Uint8Array(8192);
  for (let i = 0; i < c64.length; i++) c64[i] = (i * 17 + 0x4a) & 0xff;
  for (let i = 0; i < d41.length; i++) d41[i] = (i * 13 + 0x41) & 0xff;
  return {
    "JiffyDOS_C64_6.01.bin": [...c64],
    "JiffyDOS_1541-II_6.00.bin": [...d41],
  };
}

export async function applySyntheticJiffy(page) {
  const pair = synthJiffyPair();
  await page.evaluate(async (roms) => {
    for (const [name, bytes] of Object.entries(roms)) {
      const id = /1541/i.test(name) ? "jiffy-1541" : "jiffy-c64";
      await window.__g64?.putRomBytes?.(id, name, bytes);
    }
    window.__g64?.setJiffyDos?.(true);
  }, pair);
}

/** Dirty-profile style power off → on (matches geos-insert-user-dirty). */
export async function powerCycleDesktop(page) {
  await page.locator('button[aria-label="Power off"]').first().click({ timeout: 15_000 });
  await page.waitForTimeout(2500);
  await page.locator('button[aria-label="Power on"], .g64-power').first().click({ timeout: 15_000 });
  await waitRunning(page, 120_000);
}

/** Software → On this device → Insert on unit (user path; no playBytes). */
export async function insertFloppyViaLibraryUI(page, { filePath, fileName, unit }) {
  const esc = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page.locator('button[aria-label="Software"]').click({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /On this device/i }).click();
  await page.waitForTimeout(300);
  await page.locator('input[type="file"]').setInputFiles(filePath);
  await page.waitForTimeout(1500);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(400);
  await page.locator('button[aria-label="Software"]').click({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /On this device/i }).click();
  await page.waitForTimeout(300);
  await page
    .getByRole("button", { name: new RegExp(`Insert ${esc}`) })
    .first()
    .click({ timeout: 60_000 });
  await waitRunning(page, 180_000);
  await page.waitForTimeout(4000);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
}

/** Dismiss overlays and focus the CRT before per-char typing. */
export async function focusC64ForTyping(page) {
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(120);
  }
  await page.locator("#grok64-player canvas, .g64-crt canvas").first().click({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(400);
}

export async function captureViceDriveBus(page) {
  const diag = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
  return {
    viceDriveBus: diag?.viceDriveBus ?? null,
    viceLastReattach: diag?.viceLastReattach ?? null,
    viceLastAttachDiag: diag?.viceLastAttachDiag ?? null,
    coreBuildIdLoaded: diag?.coreBuildIdLoaded ?? null,
    coreBuildIdExpected: diag?.coreBuildIdExpected ?? null,
    coreBuildMatches: diag?.coreBuildMatches ?? null,
    grok64WasmBindRev: diag?.grok64WasmBindRev ?? null,
  };
}

/** Import fixture into library IDB if missing (for Insert UI). */
export async function ensureLibraryFixture(page, fileName, bytes) {
  await page.evaluate(
    async ({ name, b64 }) => {
      const lib = await window.__g64?.listLibraryItems?.();
      if (lib?.some?.((r) => r.name === name)) return;
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await window.__g64?.importLibraryBytes?.(name, bin);
    },
    { name: fileName, b64: Buffer.from(bytes).toString("base64") },
  );
}

/** Mount fixture bytes on a specific IEC unit (no autostart). Legacy — prefer insertFloppyViaLibraryUI. */
export async function mountFloppyOnUnit(page, { fileName, bytes, unit, title }) {
  await page.evaluate(
    async ({ fileName, bytes, unit, title }) => {
      await window.__g64?.playBytes?.(fileName, bytes, {
        autostart: false,
        diskLoad: true,
        title: title ?? fileName,
        iecUnit: unit,
      });
    },
    { fileName, bytes, unit, title },
  );
}

/**
 * LOAD"$",unit + LIST — PASS when no IEC errors and listing has content.
 * @param {import('playwright').Page} page
 * @param {number} unit
 */
export async function dirOnUnit(page, unit, { requireWorkBytes = true, typed = true } = {}) {
  if (typed) {
    await focusC64ForTyping(page);
    await typeC64Screen(page, `LOAD"$",${unit}`, { keyDelayMs: 110 });
    const loadWait = await waitForDollarLoad(page, { maxMs: 55_000 });
    if (loadWait.error) {
      return {
        ok: false,
        textHead: loadWait.text?.slice(0, 120) ?? "",
        listHead: "",
        workBytes: 0,
        list: loadWait.text ?? "",
      };
    }
    await page.waitForTimeout(2000);
    await typeC64Screen(page, "LIST");
    await page.waitForTimeout(12_000);
    const list = await page.evaluate(() => window.__g64?.screenText?.() || "");
    const workBytes = await page.evaluate(() => window.__g64?.workD64Bytes?.() ?? 0);
    const bytesOk = !requireWorkBytes || workBytes >= 174848;
    const ok =
      bytesOk &&
      !/FILE NOT FOUND|DEVICE NOT PRESENT/i.test(list) &&
      (/PRG|SEQ|DEL/i.test(list) || /BLOCKS FREE/i.test(list));
    return { ok, textHead: loadWait.text?.slice(0, 120) ?? "", listHead: list.slice(0, 120), workBytes, list };
  }
  await typeBasic(page, `LOAD"$",${unit}`, { afterMs: 12_000 });
  let text = "";
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(1500);
    text = await page.evaluate(() => window.__g64?.screenText?.() || "");
    if (/FILE NOT FOUND|DEVICE NOT PRESENT/i.test(text)) break;
    if (/BLOCKS FREE/i.test(text) && /PRG|SEQ|DEL|D64/i.test(text)) break;
    if (!/SEARCHING FOR|LOADING/i.test(text) && /"[\w]/.test(text)) break;
  }
  await typeBasic(page, "LIST", { afterMs: 10_000 });
  await page.waitForTimeout(2500);
  const list = await page.evaluate(() => window.__g64?.screenText?.() || "");
  const workBytes = await page.evaluate(() => window.__g64?.workD64Bytes?.() ?? 0);
  const bytesOk = !requireWorkBytes || workBytes >= 174848;
  const ok =
    bytesOk &&
    !/FILE NOT FOUND|DEVICE NOT PRESENT/i.test(text) &&
    !/FILE NOT FOUND|DEVICE NOT PRESENT/i.test(list) &&
    (/PRG|SEQ|DEL/i.test(list) || /BLOCKS FREE/i.test(text));
  return { ok, textHead: text.slice(0, 120), listHead: list.slice(0, 120), workBytes, list };
}

/** First PRG name from a C64 directory listing (LIST output). */
export function firstPrgNameFromListing(listText) {
  const m = listText.match(/"([^"]+)"\s+PRG/i);
  return m?.[1] ?? null;
}

/**
 * LOAD smoke: directory on source unit, then named LOAD of first PRG on that unit.
 */
export async function loadSmokeOnUnit(page, unit, { typed = true } = {}) {
  const dir = await dirOnUnit(page, unit, { typed });
  if (!dir.ok) return { ...dir, loadOk: false, prg: null };
  const prg = firstPrgNameFromListing(dir.list);
  if (!prg) return { ...dir, loadOk: false, prg: null, reason: "no PRG in directory listing" };
  if (typed) {
    await typeC64Screen(page, `LOAD"${prg}",${unit}`);
    await page.waitForTimeout(20_000);
  } else {
    await typeBasic(page, `LOAD"${prg}",${unit}`, { afterMs: 25_000 });
  }
  await page.waitForTimeout(3000);
  const after = await page.evaluate(() => window.__g64?.screenText?.() || "");
  const loadOk =
    !/FILE NOT FOUND|DEVICE NOT PRESENT/i.test(after) &&
    (/READY/i.test(after) || after.length > 30);
  return { ...dir, loadOk, prg, afterHead: after.slice(0, 120) };
}
