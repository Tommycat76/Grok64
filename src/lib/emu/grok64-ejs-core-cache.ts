/**
 * EmulatorJS stores extracted cores in IndexedDB (`EmulatorJS-Cache`) keyed by download URL.
 * Grok64 library lives in a separate DB (`grok64`) — never touch it here.
 */
import { GROK64_CORE_BUILD_ID, GROK64_CORE_GLUE_SHA12 } from "./grok64-core-build.generated";
import { grok64CoreBuildIdForUrl } from "./grok64-core-build";
import { appendGrok64CoreUrlCacheParams, expectedGrok64GlueSha12FromUrl } from "./grok64-core-url";
import { grok64CoreBuildMatchesExpected, loadedCoreGlueInfo } from "./grok64-core-loaded";
import { grok64DiskAttachCallableEmu } from "./grok64-wasm-direct";

export const GROK64_IEC_CORE_BLOB = "vice_x64sc-grok64-iec-wasm.data";
export const GROK64_LIBRARY_DB = "grok64";
/** CDN stable EmulatorJS legacy per-core WASM cache (keyed by `vice_x64sc-wasm.data`, not URL). */
export const EJS_LEGACY_CORE_DB = "EmulatorJS-core";
const EJS_LEGACY_CORE_STORE = "core";
const EJS_CACHE_DB = "EmulatorJS-Cache";
const EJS_CACHE_DB_VERSION = 2;

/** Matches EmulatorJS `getCore() + (-thread|-legacy) + "-wasm.data"` for vice_x64sc. */
export const VICE_X64SC_LEGACY_CORE_KEYS = [
  "vice_x64sc-wasm.data",
  "vice_x64sc-legacy-wasm.data",
  "vice_x64sc-thread-wasm.data",
  "vice_x64sc-thread-legacy-wasm.data",
] as const;

export function isLegacyViceX64scCoreStorageKey(key: string): boolean {
  const k = String(key);
  if ((VICE_X64SC_LEGACY_CORE_KEYS as readonly string[]).includes(k)) return true;
  return /^vice_x64sc(-thread|-legacy|-thread-legacy)?-wasm\.data$/i.test(k);
}

const MANIFEST_LS = "grok64.ejsCoreManifestBuildId";
const AUTO_RELOAD_SS = "grok64.coreCacheAutoReload";

type CacheMeta = {
  key: string;
  url?: string;
  type?: string;
  filename?: string;
};

function grok64ViceCoreRoot(): string | null {
  if (typeof import.meta !== "undefined" && import.meta.env?.VITE_GROK64_VICE_DATAPATH) {
    return String(import.meta.env.VITE_GROK64_VICE_DATAPATH).replace(/\/$/, "");
  }
  if (typeof window !== "undefined") {
    const w = window as unknown as { __GROK64_VICE_DATA?: string };
    if (w.__GROK64_VICE_DATA) return w.__GROK64_VICE_DATA.replace(/\/$/, "");
  }
  return null;
}

export function grok64CoreBlobUrl(): string | null {
  const root = grok64ViceCoreRoot();
  if (!root || typeof window === "undefined" || !window.location?.origin) return null;
  const rel = `${root.startsWith("/") ? root : `/${root}`}/cores/${GROK64_IEC_CORE_BLOB}`;
  return appendGrok64CoreUrlCacheParams(`${window.location.origin}${rel}`);
}

function viceCoreUrl(meta: CacheMeta): boolean {
  const u = String(meta.url ?? meta.filename ?? "");
  return /vice_.*wasm\.data/i.test(u) || u.includes(GROK64_IEC_CORE_BLOB);
}

function urlBuildId(url: string): string | null {
  try {
    const q = new URL(url, window.location.origin).searchParams.get("grok64core");
    return q ? q.toLowerCase() : null;
  } catch {
    const m = url.match(/[?&]grok64core=([^&]+)/i);
    return m?.[1]?.toLowerCase() ?? null;
  }
}

function ensureEjsCacheStores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains("cache")) {
    const cacheStore = db.createObjectStore("cache");
    if (!cacheStore.indexNames.contains("type")) {
      cacheStore.createIndex("type", "type", { unique: false });
    }
    if (!cacheStore.indexNames.contains("url")) {
      cacheStore.createIndex("url", "url", { unique: false });
    }
  }
  if (!db.objectStoreNames.contains("blobs")) {
    db.createObjectStore("blobs");
  }
}

export function patchIndexedDbForEmulatorJsCache(): void {
  if (typeof indexedDB === "undefined") return;
  const w = window as unknown as { __g64IdbOpenPatched?: boolean };
  if (w.__g64IdbOpenPatched) return;
  w.__g64IdbOpenPatched = true;

  const origOpen = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function (this: IDBFactory, name: string, version?: number): IDBOpenDBRequest {
    if (name === GROK64_LIBRARY_DB) {
      return origOpen.call(this, name, version);
    }
    if (name !== EJS_CACHE_DB) {
      return origOpen.call(this, name, version);
    }
    const req = origOpen.call(this, name, Math.max(version ?? 1, EJS_CACHE_DB_VERSION));
    req.addEventListener("upgradeneeded", (ev) => {
      const db = (ev.target as IDBOpenDBRequest).result;
      ensureEjsCacheStores(db);
    });
    return req;
  };
}

function openEjsCacheDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  patchIndexedDbForEmulatorJsCache();
  return new Promise((resolve) => {
    const req = indexedDB.open(EJS_CACHE_DB, EJS_CACHE_DB_VERSION);
    req.onerror = () => resolve(null);
    req.onupgradeneeded = () => {
      ensureEjsCacheStores(req.result);
    };
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("cache") || !db.objectStoreNames.contains("blobs")) {
        db.close();
        resolve(null);
        return;
      }
      resolve(db);
    };
  });
}

function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  if (!db.objectStoreNames.contains(store)) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => resolve(undefined);
      tx.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

function idbPut(db: IDBDatabase, store: string, key: string, value: unknown): Promise<void> {
  if (!db.objectStoreNames.contains(store)) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

function idbDelete(db: IDBDatabase, store: string, key: string): Promise<void> {
  if (!db.objectStoreNames.contains(store)) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function listCacheMetas(db: IDBDatabase): Promise<CacheMeta[]> {
  const keys = await idbGet<string[]>(db, "cache", "?EJS_KEYS!");
  if (!keys?.length) return [];
  const out: CacheMeta[] = [];
  for (const key of keys) {
    if (key === "?EJS_KEYS!") continue;
    const meta = await idbGet<CacheMeta>(db, "cache", key);
    if (meta?.key) out.push(meta);
  }
  return out;
}

async function removeBlobManifest(db: IDBDatabase, parentKey: string): Promise<void> {
  const manifest = await idbGet<{ files?: { key?: string; type?: string; chunkCount?: number }[] }>(
    db,
    "blobs",
    parentKey,
  );
  if (!manifest?.files) return;
  for (const file of manifest.files) {
    if (!file?.key) continue;
    if (file.type === "chunked" && file.chunkCount) {
      for (let i = 0; i < file.chunkCount; i++) {
        await idbDelete(db, "blobs", `${file.key}__chunk__${i}`);
      }
    } else {
      await idbDelete(db, "blobs", file.key);
    }
  }
  await idbDelete(db, "blobs", parentKey);
}

async function deleteCacheEntry(db: IDBDatabase, key: string): Promise<void> {
  await removeBlobManifest(db, key);
  await idbDelete(db, "cache", key);
  const keys = await idbGet<string[]>(db, "cache", "?EJS_KEYS!");
  if (!keys) return;
  const next = keys.filter((k) => k !== key);
  if (!db.objectStoreNames.contains("cache")) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction("cache", "readwrite");
      tx.objectStore("cache").put(next, "?EJS_KEYS!");
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export type Grok64EjsCachePurgeResult = { removed: number; reason: string };

function isStaleViceCoreMeta(meta: CacheMeta, expectedUrl: string | null, expectedId: string | null): boolean {
  const u = String(meta.url ?? "");
  const isCore = meta.type === "Core" || meta.type === "core";
  if (!isCore && !viceCoreUrl(meta)) return false;
  if (!viceCoreUrl(meta) && !isCore) return false;

  if (/cdn\.emulatorjs\.org/i.test(u)) return true;
  if (!u) return true;

  const glue = expectedGrok64GlueSha12FromUrl(u);
  if (GROK64_CORE_GLUE_SHA12) {
    if (!glue || glue !== GROK64_CORE_GLUE_SHA12) return true;
  }

  if (!expectedUrl) return true;
  if (u !== expectedUrl) return true;
  if (expectedId && urlBuildId(u) !== expectedId) return true;
  if (!expectedId && urlBuildId(u) != null) return true;
  return false;
}

/** Remove every EmulatorJS **Core** row (VICE/libretro WASM archives only — not ROM/BIOS). */
export async function purgeAllEmulatorJsCoreRows(reason = "purge-all-core"): Promise<Grok64EjsCachePurgeResult> {
  const db = await openEjsCacheDb();
  if (!db) return { removed: 0, reason: `${reason}:no-db` };
  const metas = await listCacheMetas(db);
  let removed = 0;
  for (const meta of metas) {
    const t = String(meta.type ?? "");
    if (!/^core$/i.test(t)) continue;
    await deleteCacheEntry(db, meta.key);
    removed++;
  }
  db.close();
  return { removed, reason };
}

/** Drop stale VICE / Grok64 core rows (URL, glue fingerprint, or CDN). */
export async function purgeEmulatorJsViceCoreCache(reason: string): Promise<Grok64EjsCachePurgeResult> {
  const db = await openEjsCacheDb();
  if (!db) return { removed: 0, reason: `${reason}:no-db` };
  const expectedUrl = grok64CoreBlobUrl();
  const expectedId = grok64CoreBuildIdForUrl();
  const metas = await listCacheMetas(db);
  let removed = 0;
  for (const meta of metas) {
    if (!isStaleViceCoreMeta(meta, expectedUrl, expectedId)) continue;
    await deleteCacheEntry(db, meta.key);
    removed++;
  }
  db.close();
  return { removed, reason };
}

/** Run before EmulatorJS boots — purge stale core rows only; never deleteDatabase. */
export async function syncEmulatorJsCoreCacheWithManifest(): Promise<Grok64EjsCachePurgeResult | null> {
  if (!grok64ViceCoreRoot() || !GROK64_CORE_BUILD_ID) return null;
  patchIndexedDbForEmulatorJsCache();
  const prev = typeof localStorage !== "undefined" ? localStorage.getItem(MANIFEST_LS) : null;
  const manifestBump = prev !== GROK64_CORE_BUILD_ID;
  const reason = manifestBump ? "manifest-build-id-changed" : "vice-core-url-sync";
  let removed = 0;
  // Every boot: drop EmulatorJS Core IDB rows so stale blobs cannot win over network (dontCache does not skip IDB read).
  removed += (await purgeAllEmulatorJsCoreRows(`${reason}:boot-all-core`)).removed;
  removed += (await purgeEmulatorJsViceCoreCache(reason)).removed;
  removed += (await purgeEmulatorJsLegacyCoreViceRows(reason)).removed;
  if (manifestBump) {
    try {
      localStorage.setItem(MANIFEST_LS, GROK64_CORE_BUILD_ID);
    } catch {
      /* ignore */
    }
  }
  return { removed, reason };
}

export function patchFetchNoStoreForGrok64Core(): void {
  if (typeof window === "undefined" || (window as unknown as { __g64CoreFetch?: boolean }).__g64CoreFetch) {
    return;
  }
  (window as unknown as { __g64CoreFetch?: boolean }).__g64CoreFetch = true;
  const orig = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input instanceof Request
            ? input.url
            : "";
    if (url.includes(GROK64_IEC_CORE_BLOB) || /\/cores\/vice_.*wasm\.data/i.test(url)) {
      init = { ...init, cache: "no-store" };
    }
    return orig(input, init);
  };
}

export async function forceFreshGrok64CoreDownloadCache(): Promise<void> {
  await purgeAllEmulatorJsCoreRows("force-fresh-core");
  await purgeEmulatorJsViceCoreCache("force-fresh-core");
  await purgeEmulatorJsLegacyCoreViceRows("force-fresh-core");
}

function openLegacyIdbDb(dbName: string, storeName = EJS_LEGACY_CORE_STORE): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(dbName, 1);
    req.onerror = () => resolve(null);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.close();
        resolve(null);
        return;
      }
      resolve(db);
    };
  });
}

async function removeLegacyObjectStoreKey(db: IDBDatabase, store: string, key: string): Promise<void> {
  await idbDelete(db, store, key);
  const keys = await idbGet<string[]>(db, store, "?EJS_KEYS!");
  if (!keys?.length) return;
  const next = keys.filter((k) => k !== key);
  await idbPut(db, store, "?EJS_KEYS!", next);
}

/** Delete stale `vice_x64sc*-wasm.data` rows from EmulatorJS-core only (never deleteDatabase). */
export async function purgeEmulatorJsLegacyCoreViceRows(reason = "legacy-core"): Promise<Grok64EjsCachePurgeResult> {
  const db = await openLegacyIdbDb(EJS_LEGACY_CORE_DB);
  if (!db) return { removed: 0, reason: `${reason}:no-db` };
  if (!db.objectStoreNames.contains(EJS_LEGACY_CORE_STORE)) {
    db.close();
    return { removed: 0, reason: `${reason}:no-store` };
  }
  const keys = (await idbGet<string[]>(db, EJS_LEGACY_CORE_STORE, "?EJS_KEYS!")) ?? [];
  let removed = 0;
  for (const key of keys) {
    if (key === "?EJS_KEYS!") continue;
    if (!isLegacyViceX64scCoreStorageKey(key)) continue;
    await removeLegacyObjectStoreKey(db, EJS_LEGACY_CORE_STORE, key);
    removed++;
  }
  db.close();
  return { removed, reason };
}

export type Grok64LegacyCoreIdbDiag = {
  db: string;
  store: string;
  keys: string[];
  viceRows: { key: string; version: unknown; byteLength: number | null }[];
};

export async function grok64LegacyCoreIdbDiag(): Promise<Grok64LegacyCoreIdbDiag | null> {
  const db = await openLegacyIdbDb(EJS_LEGACY_CORE_DB);
  if (!db || !db.objectStoreNames.contains(EJS_LEGACY_CORE_STORE)) {
    db?.close();
    return null;
  }
  const keys = (await idbGet<string[]>(db, EJS_LEGACY_CORE_STORE, "?EJS_KEYS!")) ?? [];
  const viceRows: Grok64LegacyCoreIdbDiag["viceRows"] = [];
  for (const key of keys) {
    if (!isLegacyViceX64scCoreStorageKey(key)) continue;
    const row = await idbGet<{ version?: unknown; data?: ArrayBuffer }>(db, EJS_LEGACY_CORE_STORE, key);
    viceRows.push({
      key,
      version: row?.version ?? null,
      byteLength: row?.data && typeof row.data.byteLength === "number" ? row.data.byteLength : null,
    });
  }
  db.close();
  return { db: EJS_LEGACY_CORE_DB, store: EJS_LEGACY_CORE_STORE, keys, viceRows };
}

/** QA: rows in EmulatorJS-Cache with type Core. */
export async function qaCountEmulatorJsCoreCacheRows(): Promise<number> {
  const db = await openEjsCacheDb();
  if (!db) return 0;
  const metas = await listCacheMetas(db);
  db.close();
  return metas.filter((m) => /^core$/i.test(String(m.type ?? ""))).length;
}

/**
 * QA: insert metadata for a stale core URL (grok64core without grok64glue) like upgraded real profiles.
 * Does not write blob payloads — EJS should miss blobs and refetch after purge.
 */
async function writeEjsCoreCacheBlob(
  db: IDBDatabase,
  cacheKey: string,
  meta: Record<string, unknown>,
  filename: string,
  bytes: Uint8Array,
): Promise<void> {
  const fileKey = `${cacheKey}__blob__0`;
  await idbPut(db, "blobs", fileKey, bytes);
  await idbPut(db, "blobs", cacheKey, {
    _ejsBlobManifest: true,
    files: [{ filename, type: "single", key: fileKey }],
  });
  await idbPut(db, "cache", cacheKey, meta);
  const keys = (await idbGet<string[]>(db, "cache", "?EJS_KEYS!")) ?? [];
  if (!keys.includes(cacheKey)) keys.push(cacheKey);
  await idbPut(db, "cache", "?EJS_KEYS!", keys);
}

/**
 * QA: poison IDB with stock vice *.data bytes keyed to the current Grok64 canonical URL (Tom-shaped stale blob).
 */
export async function qaSeedStaleEmulatorJsCoreCacheWithStockBlob(): Promise<{
  key: string;
  url: string;
  bytes: number;
  stockSha12: string | null;
} | null> {
  patchIndexedDbForEmulatorJsCache();
  const root = grok64ViceCoreRoot();
  if (!root || typeof window === "undefined") return null;
  const rel = `${root.startsWith("/") ? root : `/${root}`}/cores/vice_x64sc-wasm.data`;
  const stockUrl = `${window.location.origin}${rel}`;
  const res = await fetch(stockUrl, { cache: "no-store" });
  if (!res.ok) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  const { sha256PrefixAsync } = await import("./grok64-core-loaded");
  const stockSha12 = await sha256PrefixAsync(buf);

  const canonical = grok64CoreBlobUrl();
  if (!canonical) return null;

  const db = await openEjsCacheDb();
  if (!db) return null;
  const key = `Obj-qa-stale-blob-${Date.now()}`;
  const now = Date.now();
  const meta = {
    key,
    url: canonical,
    type: "Core",
    filename: "vice_x64sc-wasm.data",
    added: now,
    lastAccessed: now,
    fileSize: buf.byteLength,
    responseType: "arraybuffer",
    cacheExpiry: now + 7 * 86400000,
  };
  await writeEjsCoreCacheBlob(db, key, meta, "vice_x64sc-wasm.data", buf);
  db.close();
  return { key, url: canonical, bytes: buf.byteLength, stockSha12 };
}

/**
 * QA: poison EmulatorJS-core (CDN legacy store) with stock `vice_x64sc-wasm.data` bytes — Tom profile shape.
 */
export async function qaSeedEmulatorJsLegacyCoreStockBlob(): Promise<{
  key: string;
  version: unknown;
  bytes: number;
} | null> {
  const root = grok64ViceCoreRoot();
  if (!root || typeof window === "undefined") return null;
  const origin = window.location.origin;
  const base = `${root.startsWith("/") ? root : `/${root}`}`;
  const stockUrl = `${origin}${base}/cores/vice_x64sc-wasm.data`;
  const reportUrl = `${origin}${base}/cores/reports/vice_x64sc.json`;
  const [stockRes, reportRes] = await Promise.all([
    fetch(stockUrl, { cache: "no-store" }),
    fetch(reportUrl, { cache: "no-store" }),
  ]);
  if (!stockRes.ok) return null;
  const buf = new Uint8Array(await stockRes.arrayBuffer());
  let version: unknown = 1;
  if (reportRes.ok) {
    try {
      const rep = (await reportRes.json()) as { buildStart?: unknown };
      if (rep.buildStart != null) version = rep.buildStart;
    } catch {
      /* ignore */
    }
  }
  const db = await openLegacyIdbDb(EJS_LEGACY_CORE_DB);
  if (!db) return null;
  if (!db.objectStoreNames.contains(EJS_LEGACY_CORE_STORE)) {
    db.close();
    return null;
  }
  const key = "vice_x64sc-wasm.data";
  const data =
    buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength
      ? buf.buffer
      : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  await idbPut(db, EJS_LEGACY_CORE_STORE, key, { version, data });
  const keys = (await idbGet<string[]>(db, EJS_LEGACY_CORE_STORE, "?EJS_KEYS!")) ?? [];
  if (!keys.includes(key)) keys.push(key);
  await idbPut(db, EJS_LEGACY_CORE_STORE, "?EJS_KEYS!", keys);
  db.close();
  return { key, version, bytes: buf.byteLength };
}

export async function qaSeedStaleEmulatorJsCoreCacheRow(): Promise<{ key: string; url: string } | null> {
  patchIndexedDbForEmulatorJsCache();
  const buildId = grok64CoreBuildIdForUrl();
  const root = grok64ViceCoreRoot();
  if (!buildId || !root || typeof window === "undefined") return null;
  const rel = `${root.startsWith("/") ? root : `/${root}`}/cores/${GROK64_IEC_CORE_BLOB}`;
  const staleUrl = `${window.location.origin}${rel}?grok64core=${encodeURIComponent(buildId)}`;
  const db = await openEjsCacheDb();
  if (!db) return null;
  const key = `Obj-qa-stale-${Date.now()}`;
  const now = Date.now();
  const meta = {
    key,
    url: staleUrl,
    type: "Core",
    filename: "vice_x64sc-wasm.data",
    added: now,
    lastAccessed: now,
    fileSize: 1,
    responseType: "arraybuffer",
    cacheExpiry: now + 7 * 86400000,
  };
  await idbPut(db, "cache", key, meta);
  const keys = (await idbGet<string[]>(db, "cache", "?EJS_KEYS!")) ?? [];
  if (!keys.includes(key)) keys.push(key);
  await idbPut(db, "cache", "?EJS_KEYS!", keys);
  db.close();
  return { key, url: staleUrl };
}

export async function maybeAutoRefreshStaleEmulatorCore(emu: { Module?: unknown } | null): Promise<boolean> {
  if (!grok64ViceCoreRoot() || !GROK64_CORE_BUILD_ID) return false;
  if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(AUTO_RELOAD_SS)) return false;

  for (let i = 0; i < 60; i++) {
    const g = loadedCoreGlueInfo();
    if (!g) {
      await new Promise((r) => setTimeout(r, 50));
      continue;
    }
    if (!g.glueHasDiskExports) break;
    if (g.glueSha12 != null) break;
    await new Promise((r) => setTimeout(r, 50));
  }

  const glue = loadedCoreGlueInfo();
  if (!glue || glue.glueBytes <= 0) return false;

  const exportsOk = grok64DiskAttachCallableEmu(emu);
  const matches = grok64CoreBuildMatchesExpected();
  if (exportsOk && matches) {
    try {
      sessionStorage.removeItem(AUTO_RELOAD_SS);
    } catch {
      /* ignore */
    }
    return false;
  }

  const glueShaMismatch =
    Boolean(glue.glueSha12 && GROK64_CORE_GLUE_SHA12 && glue.glueSha12 !== GROK64_CORE_GLUE_SHA12);
  const needsRefresh =
    !glue.glueHasDiskExports ||
    glueShaMismatch ||
    (glue.glueSha12 != null && !matches) ||
    (glue.glueHasDiskExports &&
      glue.glueSha12 === GROK64_CORE_GLUE_SHA12 &&
      GROK64_CORE_GLUE_SHA12 &&
      !exportsOk);
  if (!needsRefresh) return false;

  await forceFreshGrok64CoreDownloadCache();
  try {
    sessionStorage.setItem(AUTO_RELOAD_SS, "1");
  } catch {
    /* ignore */
  }
  window.location.reload();
  return true;
}

function viceCoreDownloadUrl(url: string): boolean {
  const u = String(url);
  return (
    u.includes(GROK64_IEC_CORE_BLOB) ||
    /\/cores\/vice_.*wasm\.data/i.test(u) ||
    viceCoreUrl({ key: "", url: u })
  );
}

/**
 * EmulatorJS `dontCache` skips IDB write but still reads IDB by URL — bypass storage for VICE cores.
 */
type EjsDownloaderLike = {
  downloadFile?: (...args: unknown[]) => unknown;
  storageCache?: unknown;
  __g64Bypass?: boolean;
};

type EjsLegacyStorageLike = {
  get?: (key: string) => Promise<unknown>;
  put?: (key: string, data: unknown) => Promise<void>;
  __g64LegacyCore?: boolean;
};

type Grok64PatchedEjsInstance = {
  downloader?: EjsDownloaderLike;
  storage?: { core?: EjsLegacyStorageLike };
};

function wrapEmulatorJsLegacyCoreStorage(inst: Grok64PatchedEjsInstance): void {
  if (!grok64ViceCoreRoot()) return;
  const core = inst.storage?.core;
  if (!core?.get || core.__g64LegacyCore) return;
  core.__g64LegacyCore = true;
  const origGet = core.get.bind(core);
  core.get = async (key: string) => {
    if (isLegacyViceX64scCoreStorageKey(String(key))) return undefined;
    return origGet(key);
  };
  if (core.put) {
    const origPut = core.put.bind(core);
    core.put = async (key: string, data: unknown) => {
      if (isLegacyViceX64scCoreStorageKey(String(key))) return;
      return origPut(key, data);
    };
  }
}

export function patchEmulatorJsDownloaderCoreCacheBypass(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as {
    EmulatorJS?: new (...a: unknown[]) => Grok64PatchedEjsInstance;
    __g64EjsDlBypass?: boolean;
  };
  const EJS = w.EmulatorJS;
  if (!EJS || w.__g64EjsDlBypass) return;
  w.__g64EjsDlBypass = true;

  const wrapDownloader = (dl: EjsDownloaderLike | undefined) => {
    if (!dl?.downloadFile || dl.__g64Bypass) return;
    dl.__g64Bypass = true;
    const orig = dl.downloadFile.bind(dl);
    dl.downloadFile = function bypassCoreIdbRead(...args: unknown[]) {
      const url = String(args[0] ?? "");
      const type = String(args[1] ?? "");
      const isCore = /^core$/i.test(type) || viceCoreDownloadUrl(url);
      if (!isCore) return orig(...args);
      if (args.length > 10) args[10] = true;
      const storageCache = dl.storageCache;
      dl.storageCache = null;
      try {
        return orig(...args);
      } finally {
        dl.storageCache = storageCache;
      }
    };
  };

  const Orig = EJS;
  const Wrapped = function Grok64PatchedEmulatorJS(this: unknown, ...args: unknown[]) {
    const inst = Reflect.construct(Orig, args, Wrapped) as Grok64PatchedEjsInstance;
    wrapDownloader(inst.downloader);
    wrapEmulatorJsLegacyCoreStorage(inst);
    return inst;
  } as unknown as typeof EJS;
  Wrapped.prototype = Orig.prototype;
  w.EmulatorJS = Wrapped;
}
