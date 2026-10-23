/**
 * Grok64 custom VICE core — Playwright network guard + WASM export assertions.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const GROK64_IEC_CORE_FILE = "vice_x64sc-grok64-iec-wasm.data";

export function grok64DatapathFromEnv() {
  try {
    const raw = readFileSync(join(process.cwd(), ".grok/app-env.json"), "utf8");
    const j = JSON.parse(raw);
    const p = j.VITE_GROK64_VICE_DATAPATH;
    return p ? String(p).replace(/\/$/, "") : null;
  } catch {
    return process.env.VITE_GROK64_VICE_DATAPATH?.replace(/\/$/, "") || null;
  }
}

export function grok64CoreBlobUrl(baseUrl) {
  const root = grok64DatapathFromEnv();
  if (!root) return null;
  const path = `${root.startsWith("/") ? root : `/${root}`}/cores/${GROK64_IEC_CORE_FILE}`;
  return new URL(path, baseUrl).href;
}

/** Block CDN / stock vice *.data; only allow the Grok64 IEC blob. */
export async function installGrok64CoreNetworkGuard(page, baseUrl) {
  const allowed = grok64CoreBlobUrl(baseUrl);
  if (!allowed) return { enabled: false, allowed: null };
  await page.route("**/*", (route) => {
    const u = route.request().url();
    if (/cdn\.emulatorjs\.org/i.test(u) && /\/cores\/vice_.*wasm\.data/i.test(u)) {
      return route.abort("failed");
    }
    if (/\/cores\/vice_.*wasm\.data/i.test(u) && !u.includes(GROK64_IEC_CORE_FILE)) {
      if (allowed && u.startsWith(new URL(baseUrl).origin)) {
        return route.continue({ url: allowed });
      }
      return route.abort("failed");
    }
    return route.continue();
  });
  return { enabled: true, allowed };
}

export async function clearEmulatorJsCache(page) {
  await page.evaluate(async () => {
    if (!indexedDB.databases) return;
    for (const db of await indexedDB.databases()) {
      if (db.name && /emulatorjs|EmulatorJS/i.test(db.name)) {
        indexedDB.deleteDatabase(db.name);
      }
    }
  });
}

export async function readGrok64CoreStatus(page) {
  return page.evaluate(() => window.__g64?.grok64CoreStatus?.() ?? null);
}

/** Fail unless custom core WASM exports are present (required when VITE_GROK64_VICE_DATAPATH is set). */
export async function assertGrok64WasmCore(page, { timeoutMs = 90000 } = {}) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await readGrok64CoreStatus(page);
    if (last?.attach && last?.c64read) return last;
    await page.waitForTimeout(500);
  }
  const blocked = await page.evaluate(() => window.__GROK64_STOCK_CORE_BLOCKED__ ?? []);
  throw new Error(
    `Grok64 WASM core exports missing after ${timeoutMs}ms: ${JSON.stringify({ last, blocked })}`,
  );
}
