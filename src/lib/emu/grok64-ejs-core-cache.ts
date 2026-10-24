/**
 * EmulatorJS stores extracted cores in IndexedDB (`EmulatorJS-Cache`) keyed by download URL.
 * Grok64 library lives in a separate DB (`grok64`) — never touch it here.
 */
import { GROK64_CORE_BUILD_ID } from "./grok64-core-build.generated";
import { grok64CoreBuildIdForUrl } from "./grok64-core-build";
import { grok64CoreBuildMatchesExpected, loadedCoreGlueInfo } from "./grok64-core-loaded";
import { grok64DiskAttachCallableEmu } from "./grok64-wasm-direct";

export const GROK64_IEC_CORE_BLOB = "vice_x64sc-grok64-iec-wasm.data";
export const GROK64_LIBRARY_DB = "grok64";
const EJS_CACHE_DB = "EmulatorJS-Cache";
/** EJS ships with version 1; we bump to 2 so onupgradeneeded can recreate missing stores after a bad open. */
const EJS_CACHE_DB_VERSION = 2;

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

function grok64CoreBlobUrl(): string | null {
  const root = grok64ViceCoreRoot();
  if (!root || typeof window === "undefined" || !window.location?.origin) return null;
  const rel = `${root.startsWith("/") ? root : `/${root}`}/cores/${GROK64_IEC_CORE_BLOB}`;
  const buildId = grok64CoreBuildIdForUrl();
  let url = `${window.location.origin}${rel}`;
  if (buildId) {
    const sep = url.includes("?") ? "&" : "?";
    url = `${url}${sep}grok64core=${encodeURIComponent(buildId)}`;
  }
  return url;
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

/**
 * EmulatorJS opens `EmulatorJS-Cache` at version 1 without healing empty DBs.
 * Intercept only that database; never alter `grok64` (user library).
 */
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

/** Drop only stale VICE / Grok64 **Core** rows inside `EmulatorJS-Cache` (never the `grok64` library DB). */
export async function purgeEmulatorJsViceCoreCache(reason: string): Promise<Grok64EjsCachePurgeResult> {
  const db = await openEjsCacheDb();
  if (!db) return { removed: 0, reason: `${reason}:no-db` };
  const expectedUrl = grok64CoreBlobUrl();
  const expectedId = grok64CoreBuildIdForUrl();
  const metas = await listCacheMetas(db);
  let removed = 0;
  for (const meta of metas) {
    const isCore = meta.type === "Core" || meta.type === "core";
    if (!isCore && !viceCoreUrl(meta)) continue;
    if (!viceCoreUrl(meta)) continue;
    const u = String(meta.url ?? "");
    const staleUrl =
      !expectedUrl ||
      u !== expectedUrl ||
      (expectedId && urlBuildId(u) !== expectedId) ||
      (!expectedId && urlBuildId(u) != null);
    const staleCdn = /cdn\.emulatorjs\.org/i.test(u);
    if (staleUrl || staleCdn || !u) {
      await deleteCacheEntry(db, meta.key);
      removed++;
    }
  }
  db.close();
  return { removed, reason };
}

/** Run before EmulatorJS boots — purge stale core rows only; never deleteDatabase. */
export async function syncEmulatorJsCoreCacheWithManifest(): Promise<Grok64EjsCachePurgeResult | null> {
  if (!grok64ViceCoreRoot() || !GROK64_CORE_BUILD_ID) return null;
  patchIndexedDbForEmulatorJsCache();
  const prev = typeof localStorage !== "undefined" ? localStorage.getItem(MANIFEST_LS) : null;
  const reason = prev !== GROK64_CORE_BUILD_ID ? "manifest-build-id-changed" : "vice-core-url-sync";
  const purge = await purgeEmulatorJsViceCoreCache(reason);
  if (prev !== GROK64_CORE_BUILD_ID) {
    try {
      localStorage.setItem(MANIFEST_LS, GROK64_CORE_BUILD_ID);
    } catch {
      /* ignore */
    }
  }
  return purge;
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

export async function maybeAutoRefreshStaleEmulatorCore(emu: { Module?: unknown } | null): Promise<boolean> {
  if (!grok64ViceCoreRoot() || !GROK64_CORE_BUILD_ID) return false;
  if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(AUTO_RELOAD_SS)) return false;

  for (let i = 0; i < 24; i++) {
    const g = loadedCoreGlueInfo();
    if (g?.glueSha12 != null || g?.glueHasDiskExports === false) break;
    await new Promise((r) => setTimeout(r, 50));
  }

  const glue = loadedCoreGlueInfo();
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
  if (!glue?.glueSha12) return false;

  const needsRefresh =
    !glue.glueHasDiskExports || !matches || (glue.glueHasDiskExports && !exportsOk);
  if (!needsRefresh) return false;

  await purgeEmulatorJsViceCoreCache("stale-loaded-core");
  try {
    sessionStorage.setItem(AUTO_RELOAD_SS, "1");
  } catch {
    /* ignore */
  }
  window.location.reload();
  return true;
}
