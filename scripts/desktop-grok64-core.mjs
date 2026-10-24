/**
 * Grok64 custom VICE core — Playwright network guard + WASM export assertions.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const GROK64_IEC_CORE_FILE = "vice_x64sc-grok64-iec-wasm.data";

function readCoreManifest() {
  try {
    const raw = readFileSync(
      join(process.cwd(), "public/system/vice/emulatorjs/data/cores/grok64-core-manifest.json"),
      "utf8",
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function grok64CoreBuildIdFromManifest() {
  const j = readCoreManifest();
  return j?.buildId ? String(j.buildId) : null;
}

export function grok64CoreGlueShaFromManifest() {
  const j = readCoreManifest();
  return j?.glueSha12 ? String(j.glueSha12) : null;
}

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

export function grok64CoreBlobUrl(baseUrl, { cacheBust = true } = {}) {
  const root = grok64DatapathFromEnv();
  if (!root) return null;
  const path = `${root.startsWith("/") ? root : `/${root}`}/cores/${GROK64_IEC_CORE_FILE}`;
  let href = new URL(path, baseUrl).href;
  if (cacheBust) {
    const buildId = grok64CoreBuildIdFromManifest();
    const glue = grok64CoreGlueShaFromManifest();
    if (buildId) href += `${href.includes("?") ? "&" : "?"}grok64core=${encodeURIComponent(buildId)}`;
    if (glue) href += `${href.includes("?") ? "&" : "?"}grok64glue=${encodeURIComponent(glue)}`;
  }
  return href;
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
    if (allowed && /\/cores\/vice_x64sc-grok64-iec-wasm\.data/i.test(u) && u.startsWith(new URL(baseUrl).origin)) {
      if (!u.includes("grok64core=") && allowed.includes("grok64core=")) {
        return route.continue({ url: allowed });
      }
    }
    return route.continue();
  });
  return { enabled: true, allowed };
}

/** QA only — drops EmulatorJS download cache, never the `grok64` user library DB. */
export async function clearEmulatorJsCache(page) {
  await page.evaluate(async () => {
    const names = ["EmulatorJS-Cache", "EmulatorJS-states"];
    if (indexedDB.databases) {
      for (const db of await indexedDB.databases()) {
        if (db.name && /^EmulatorJS/i.test(db.name) && db.name !== "grok64") {
          if (!names.includes(db.name)) names.push(db.name);
        }
      }
    }
    for (const name of names) {
      if (name === "grok64") continue;
      await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      });
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
    const diag = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
    const diskOk =
      diag?.diskAttachExport === true &&
      diag?.wasmExportCallable?.grok64_disk_attach === true;
    if (last?.attach && last?.c64read && diskOk) return { ...last, attachDiskDiag: diag };
    await page.waitForTimeout(500);
  }
  const blocked = await page.evaluate(() => window.__GROK64_STOCK_CORE_BLOCKED__ ?? []);
  throw new Error(
    `Grok64 WASM core exports missing after ${timeoutMs}ms: ${JSON.stringify({ last, blocked })}`,
  );
}
