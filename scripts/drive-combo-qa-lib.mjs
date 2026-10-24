/**
 * Shared Playwright helpers for drive-combo matrix (see docs/DRIVE_COMBO_MATRIX.md).
 */
import { typeBasic } from "./desktop-qa-lib.mjs";

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

/** Mount fixture bytes on a specific IEC unit (no autostart). */
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
export async function dirOnUnit(page, unit, { requireWorkBytes = true } = {}) {
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
export async function loadSmokeOnUnit(page, unit) {
  const dir = await dirOnUnit(page, unit);
  if (!dir.ok) return { ...dir, loadOk: false, prg: null };
  const prg = firstPrgNameFromListing(dir.list);
  if (!prg) return { ...dir, loadOk: false, prg: null, reason: "no PRG in directory listing" };
  await typeBasic(page, `LOAD"${prg}",${unit}`, { afterMs: 25_000 });
  await page.waitForTimeout(3000);
  const after = await page.evaluate(() => window.__g64?.screenText?.() || "");
  const loadOk =
    !/FILE NOT FOUND|DEVICE NOT PRESENT/i.test(after) &&
    (/READY/i.test(after) || after.length > 30);
  return { ...dir, loadOk, prg, afterHead: after.slice(0, 120) };
}
