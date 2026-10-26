/**
 * EmulatorJS stores extracted cores in IndexedDB (`EmulatorJS-Cache`) keyed by download URL
 * and in `EmulatorJS-core` keyed by filename. Grok64 library lives in a separate DB
 * (`grok64`) — never touch it here.
 */
import { GROK64_CORE_BUILD_ID, GROK64_CORE_BYTES, GROK64_CORE_GLUE_SHA12 } from "./grok64-core-build.generated";
import { grok64CoreBuildIdForUrl } from "./grok64-core-build";
import {
  appendGrok64CoreUrlCacheParams,
  expectedGrok64GlueSha12FromUrl,
  GROK64_CORE_AUTO_RELOAD_SS,
  GROK64_CORE_HEAL_PENDING_SS,
  GROK64_CORE_LAST_FETCH_SS,
  GROK64_CORE_STALE_STICKY_SS,
} from "./grok64-core-url";
import { grok64CoreBuildMatchesExpected, loadedCoreGlueInfo, runningCoreMismatch } from "./grok64-core-loaded";
import { grok64DiskAttachCallableEmu } from "./grok64-wasm-direct";

export const GROK64_IEC_CORE_BLOB = "vice_x64sc-grok64-iec-wasm.data";

/** Versioned on-disk name — EmulatorJS IDB must not reuse stock `vice_x64sc-wasm.data` keys. */
export function grok64IecCoreBlobLeaf(): string {
  return GROK64_CORE_BUILD_ID
    ? `vice_x64sc-grok64-iec-wasm-${GROK64_CORE_BUILD_ID}.data`
    : GROK64_IEC_CORE_BLOB;
}
export const GROK64_LIBRARY_DB = "grok64";
/** CDN stable EmulatorJS legacy per-core WASM cache (keyed by `vice_x64sc-wasm.data`, not URL). */
export const EJS_LEGACY_CORE_DB = "EmulatorJS-core";
const EJS_LEGACY_CORE_STORE = "core";
export const EJS_ROMS_DB = "EmulatorJS-roms";
const EJS_ROMS_STORE = "rom";
export const EJS_BIOS_DB = "EmulatorJS-bios";
const EJS_BIOS_STORE = "bios";
export const EJS_STATES_DB = "EmulatorJS-states";
const EJS_STATES_STORE = "states";
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
  const k = String(key).split("?")[0].split("/").pop() ?? String(key);
  if ((VICE_X64SC_LEGACY_CORE_KEYS as readonly string[]).includes(k)) return true;
  return /^vice_x64sc(-thread|-legacy|-thread-legacy)?-wasm\.data$/i.test(k);
}

/** Any EmulatorJS store key that can hold a VICE / Grok64 .data core (not a user save state). */
export function isEmulatorJsViceCoreStorageKey(key: string): boolean {
  const raw = String(key);
  if (raw === "?EJS_KEYS!") return false;
  const k = raw.split("?")[0].split("#")[0].split("/").pop() ?? raw;
  if (k === "?EJS_KEYS!") return false;
  if (isLegacyViceX64scCoreStorageKey(k)) return true;
  if (k.includes(GROK64_IEC_CORE_BLOB) || raw.includes(GROK64_IEC_CORE_BLOB)) return true;
  if (/^vice_.*-wasm\.data$/i.test(k)) return true;
  return /vice_x64sc.*wasm\.data/i.test(raw);
}

const MANIFEST_LS = "grok64.ejsCoreManifestBuildId";
const AUTO_RELOAD_SS = GROK64_CORE_AUTO_RELOAD_SS;
const STICKY_SS = GROK64_CORE_STALE_STICKY_SS;
const HEAL_PENDING_SS = GROK64_CORE_HEAL_PENDING_SS;
const LAST_FETCH_SS = GROK64_CORE_LAST_FETCH_SS;
/** Reload budget after a real manifest-sized fetch still lacks disk attach. */
export const CORE_REFRESH_BUDGET = 3;
/** Hard cap so a broken network cannot loop forever. */
export const CORE_REFRESH_MAX = 6;

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
  const rel = `${root.startsWith("/") ? root : `/${root}`}/cores/${grok64IecCoreBlobLeaf()}`;
  return appendGrok64CoreUrlCacheParams(`${window.location.origin}${rel}`);
}

/** Same-origin stand-in so stray CDN vice_*.js requests never leave the app. */
export function grok64UnusedViceScriptUrl(): string | null {
  const root = grok64ViceCoreRoot();
  if (!root || typeof window === "undefined" || !window.location?.origin) return null;
  const base = root.startsWith("/") ? root : `/${root}`;
  return `${window.location.origin}${base}/cores/grok64-vice-unused.js`;
}

function viceCoreUrl(meta: CacheMeta): boolean {
  const u = String(meta.url ?? meta.filename ?? "");
  return /vice_.*wasm\.data/i.test(u) || u.includes(GROK64_IEC_CORE_BLOB);
}

/** Cache Storage / SW / XHR URLs that can keep a stale VICE core (.data, .js, .wasm). */
export function isGrok64CoreCacheRequestUrl(url: string): boolean {
  const u = String(url);
  if (u.includes(GROK64_IEC_CORE_BLOB)) return true;
  if (u.includes("grok64-vice-unused.js")) return true;
  if (/vice_[^/?#]*wasm\.data/i.test(u)) return true;
  if (/\/cores\/vice_/i.test(u) && /\.data(\?|$)/i.test(u)) return true;
  if (/cdn\.emulatorjs\.org/i.test(u) && /\/cores\/vice_/i.test(u)) return true;
  return /\/cores\/vice_.*\.(js|wasm)(\?|$)/i.test(u);
}

export function grok64CoreRefreshAttempts(): number {
  if (typeof sessionStorage === "undefined") return 0;
  try {
    const raw = sessionStorage.getItem(AUTO_RELOAD_SS);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch {
    return 0;
  }
}

export function grok64CoreStaleSticky(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    return sessionStorage.getItem(STICKY_SS) === "1";
  } catch {
    return false;
  }
}

export function grok64CoreHealPending(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    return sessionStorage.getItem(HEAL_PENDING_SS) === "1";
  } catch {
    return false;
  }
}

export function noteGrok64CoreNetworkBytes(bytes: number): void {
  if (!Number.isFinite(bytes) || bytes <= 0) return;
  try {
    sessionStorage.setItem(LAST_FETCH_SS, String(Math.floor(bytes)));
  } catch {
    /* ignore */
  }
}

function lastCoreFetchLooksCurrent(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    const n = Number(sessionStorage.getItem(LAST_FETCH_SS) || 0);
    if (!Number.isFinite(n) || n <= 0) return false;
    const expect = GROK64_CORE_BYTES || 0;
    if (expect > 0) return n >= expect * 0.95;
    return n > 200_000;
  } catch {
    return false;
  }
}

function markCoreRefreshAttempt(): number {
  const next = grok64CoreRefreshAttempts() + 1;
  try {
    sessionStorage.setItem(AUTO_RELOAD_SS, String(next));
  } catch {
    /* ignore */
  }
  return next;
}

function markCoreStaleSticky(): void {
  try {
    sessionStorage.setItem(STICKY_SS, "1");
  } catch {
    /* ignore */
  }
}

function clearCoreRefreshMarks(): void {
  try {
    sessionStorage.removeItem(AUTO_RELOAD_SS);
    sessionStorage.removeItem(STICKY_SS);
    sessionStorage.removeItem(HEAL_PENDING_SS);
    sessionStorage.removeItem(LAST_FETCH_SS);
  } catch {
    /* ignore */
  }
}

function beginCoreHealReload(): number {
  const next = markCoreRefreshAttempt();
  try {
    sessionStorage.setItem(HEAL_PENDING_SS, "1");
    // Drop the crash-play resume so a heal reload does not come back already READY
    // on the old core. Keys match play-session.ts (g64-crash-play / g64-live-play).
    sessionStorage.removeItem("g64-crash-play");
    sessionStorage.removeItem("g64-live-play");
  } catch {
    /* ignore */
  }
  return next;
}

/** Evict VICE / Grok64 core blobs from Cache Storage. Never unregisters the PWA service worker. */
export async function purgeGrok64CoreCacheStorage(reason = "core-cache-storage"): Promise<Grok64EjsCachePurgeResult> {
  if (typeof caches === "undefined") return { removed: 0, reason: `${reason}:no-caches` };
  let removed = 0;
  try {
    const names = await caches.keys();
    for (const name of names) {
      const cache = await caches.open(name);
      const reqs = await cache.keys();
      for (const req of reqs) {
        if (!isGrok64CoreCacheRequestUrl(req.url)) continue;
        try {
          if (await cache.delete(req)) removed++;
        } catch {
          /* ignore one entry */
        }
      }
    }
  } catch {
    return { removed, reason: `${reason}:error` };
  }
  return { removed, reason };
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

function openExistingIdb(dbName: string): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(dbName);
    } catch {
      resolve(null);
      return;
    }
    req.onerror = () => resolve(null);
    req.onupgradeneeded = () => {
      try {
        req.transaction?.abort();
      } catch {
        /* ignore */
      }
      try {
        req.result?.close();
      } catch {
        /* ignore */
      }
      resolve(null);
    };
    req.onsuccess = () => resolve(req.result);
  });
}

function listObjectStoreKeys(db: IDBDatabase, store: string): Promise<IDBValidKey[]> {
  if (!db.objectStoreNames.contains(store)) return Promise.resolve([]);
  return new Promise((resolve) => {
    const keys: IDBValidKey[] = [];
    try {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(keys);
          return;
        }
        keys.push(cursor.key);
        cursor.continue();
      };
      req.onerror = () => resolve(keys);
    } catch {
      resolve(keys);
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
  const out: CacheMeta[] = [];
  const seen = new Set<string>();
  const push = (meta: CacheMeta) => {
    if (!meta?.key || seen.has(meta.key)) return;
    seen.add(meta.key);
    out.push(meta);
  };
  const listed = (await idbGet<string[]>(db, "cache", "?EJS_KEYS!")) ?? [];
  const cursorKeys = await listObjectStoreKeys(db, "cache");
  const keys = [...listed, ...cursorKeys.map((k) => String(k))];
  for (const key of keys) {
    if (key === "?EJS_KEYS!") continue;
    const meta = await idbGet<CacheMeta>(db, "cache", key);
    if (meta?.key) {
      push(meta);
      continue;
    }
    if (isEmulatorJsViceCoreStorageKey(key) || viceCoreUrl({ key, filename: key })) {
      push({ key, filename: key });
    }
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
  removed += (await purgeEmulatorJsRomBiosViceRows(reason)).removed;
  removed += (await purgeGrok64CoreCacheStorage(`${reason}:cache-storage`)).removed;
  if (manifestBump) {
    try {
      localStorage.setItem(MANIFEST_LS, GROK64_CORE_BUILD_ID);
    } catch {
      /* ignore */
    }
  }
  return { removed, reason };
}

/** Pin vice_*.data to the local IEC blob. Send stray CDN vice .js/.wasm to a same-origin stand-in. */
export function rewriteGrok64CoreDownloadUrl(
  url: string,
  canonical: string | null = grok64CoreBlobUrl(),
  unusedJs: string | null = grok64UnusedViceScriptUrl(),
): string {
  if (!url) return url;
  if (/vice_.*wasm\.data/i.test(url) || url.includes(GROK64_IEC_CORE_BLOB)) {
    return canonical || url;
  }
  if (/cdn\.emulatorjs\.org/i.test(url) && /\/cores\/vice_/i.test(url)) {
    if (/\.data(\?|$)/i.test(url)) return canonical || url;
    return unusedJs || url;
  }
  return url;
}

let iecBytesCache: Promise<ArrayBuffer> | null = null;

/** Network-load the current IEC 7z and verify it is the manifest-sized blob. */
export function loadVerifiedGrok64IecCoreBytes(): Promise<ArrayBuffer> {
  if (!iecBytesCache) {
    iecBytesCache = (async () => {
      const url = grok64CoreBlobUrl();
      if (!url) throw new Error("Grok64 IEC core URL is not configured");
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Grok64 IEC core fetch failed (${res.status})`);
      const buf = await res.arrayBuffer();
      const expect = GROK64_CORE_BYTES || 0;
      if (expect > 0 && buf.byteLength < expect * 0.95) {
        throw new Error(`Grok64 IEC core short (${buf.byteLength} < ${expect})`);
      }
      noteGrok64CoreNetworkBytes(buf.byteLength);
      return buf;
    })().catch((err) => {
      iecBytesCache = null;
      throw err;
    });
  }
  return iecBytesCache;
}

export function dropVerifiedGrok64IecCoreBytesCache(): void {
  iecBytesCache = null;
}

function noteCoreResponseBytes(res: Response | null): void {
  if (!res) return;
  const len = Number(res.headers.get("content-length") || 0);
  if (len > 0) noteGrok64CoreNetworkBytes(len);
}

function stripForbiddenCoreFetchCache(init?: RequestInit): RequestInit | undefined {
  if (!init) return init;
  const next: RequestInit = { ...init };
  delete next.cache;
  if (next.headers) {
    const headers = new Headers(next.headers);
    headers.delete("Cache-Control");
    headers.delete("Pragma");
    next.headers = headers;
  }
  return next;
}

/** Rewrite vice_*.data fetches to the local IEC blob. Never set cache or custom headers. */
export function patchFetchNoStoreForGrok64Core(): void {
  if (typeof window === "undefined" || (window as unknown as { __g64CoreFetch?: boolean }).__g64CoreFetch) {
    return;
  }
  (window as unknown as { __g64CoreFetch?: boolean }).__g64CoreFetch = true;
  const orig = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    let url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input instanceof Request
            ? input.url
            : "";
    if (isGrok64CoreCacheRequestUrl(url)) {
      const next = rewriteGrok64CoreDownloadUrl(url);
      if (next !== url) {
        url = next;
        input = next;
      }
      init = stripForbiddenCoreFetchCache(init);
      const out = orig(input, init);
      void Promise.resolve(out).then((res) => noteCoreResponseBytes(res)).catch(() => undefined);
      return out;
    }
    return orig(input, init);
  };
}

/** EmulatorJS `downloadFile` uses XHR — rewrite vice_*.data to the local IEC blob; no request headers. */
export function patchXhrNoStoreForGrok64Core(): void {
  if (typeof window === "undefined" || (window as unknown as { __g64CoreXhr?: boolean }).__g64CoreXhr) {
    return;
  }
  const XHR = window.XMLHttpRequest;
  if (!XHR?.prototype?.open) return;
  (window as unknown as { __g64CoreXhr?: boolean }).__g64CoreXhr = true;
  const origOpen = XHR.prototype.open;
  XHR.prototype.open = function patchedOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    let href = String(url);
    if (isGrok64CoreCacheRequestUrl(href)) {
      href = rewriteGrok64CoreDownloadUrl(href);
      (this as XMLHttpRequest & { __g64CoreXhr?: boolean }).__g64CoreXhr = true;
    }
    return origOpen.call(
      this,
      method,
      href,
      ...(rest as [boolean, string | undefined, string | undefined]),
    );
  };
  const origSend = XHR.prototype.send;
  XHR.prototype.send = function patchedSend(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    if ((this as XMLHttpRequest & { __g64CoreXhr?: boolean }).__g64CoreXhr) {
      this.addEventListener("load", () => {
        const len = Number(this.getResponseHeader("content-length") || 0);
        if (len > 0) noteGrok64CoreNetworkBytes(len);
        else if (this.response instanceof ArrayBuffer) noteGrok64CoreNetworkBytes(this.response.byteLength);
      });
    }
    return origSend.call(this, body);
  };
}

type EjsStorageCtor = {
  prototype: {
    get?: (key: string) => Promise<unknown>;
    put?: (key: string, data: unknown) => Promise<void>;
    __g64ViceBypass?: boolean;
  };
  new (dbName: string, storeName: string): { dbName?: string };
};

/** IndexedDB get/put for VICE core keys — catch stores EJS_STORAGE did not wrap in time. */
export function patchIdbObjectStoreViceCoreBypass(): void {
  if (typeof window === "undefined" || typeof IDBObjectStore === "undefined") return;
  const w = window as unknown as { __g64IdbViceGet?: boolean };
  if (w.__g64IdbViceGet) return;
  w.__g64IdbViceGet = true;
  const origGet = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function patchedIdbGet(this: IDBObjectStore, query: IDBValidKey | IDBKeyRange) {
    try {
      const db = this.transaction.db.name;
      if (
        (db === EJS_LEGACY_CORE_DB || db === EJS_ROMS_DB || db === EJS_BIOS_DB || db === EJS_STATES_DB || db === EJS_CACHE_DB) &&
        typeof query === "string" &&
        isEmulatorJsViceCoreStorageKey(query)
      ) {
        return origGet.call(this, "__g64_no_such_vice_core__");
      }
    } catch {
      /* fall through */
    }
    return origGet.call(this, query);
  };
}

/** Bypass EmulatorJS-core/rom/bios get/put for VICE .data even if the instance wrap lost the race. */
export function patchEmulatorJsStorageViceCoreBypass(): void {
  if (typeof window === "undefined") return;
  const Ctor = (window as unknown as { EJS_STORAGE?: EjsStorageCtor }).EJS_STORAGE;
  if (!Ctor?.prototype?.get || Ctor.prototype.__g64ViceBypass) return;
  Ctor.prototype.__g64ViceBypass = true;
  const origGet = Ctor.prototype.get;
  Ctor.prototype.get = function patchedEjsGet(this: { dbName?: string }, key: string) {
    const db = String(this.dbName ?? "");
    if (
      (db === EJS_LEGACY_CORE_DB || db === EJS_ROMS_DB || db === EJS_BIOS_DB) &&
      isEmulatorJsViceCoreStorageKey(String(key))
    ) {
      return Promise.resolve(undefined);
    }
    return origGet.call(this, key);
  };
  if (Ctor.prototype.put) {
    const origPut = Ctor.prototype.put;
    Ctor.prototype.put = function patchedEjsPut(this: { dbName?: string }, key: string, data: unknown) {
      const db = String(this.dbName ?? "");
      if (
        (db === EJS_LEGACY_CORE_DB || db === EJS_ROMS_DB || db === EJS_BIOS_DB) &&
        isEmulatorJsViceCoreStorageKey(String(key))
      ) {
        return Promise.resolve();
      }
      return origPut.call(this, key, data);
    };
  }
}

export async function forceFreshGrok64CoreDownloadCache(): Promise<void> {
  await purgeAllEmulatorJsCoreRows("force-fresh-core");
  await purgeEmulatorJsViceCoreCache("force-fresh-core");
  await purgeEmulatorJsLegacyCoreViceRows("force-fresh-core");
  await purgeEmulatorJsRomBiosViceRows("force-fresh-core");
  await purgeGrok64CoreCacheStorage("force-fresh-core");
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

async function purgeViceKeysFromNamedStore(
  dbName: string,
  storeName: string,
  reason: string,
): Promise<Grok64EjsCachePurgeResult> {
  const db = (await openExistingIdb(dbName)) ?? (dbName === EJS_LEGACY_CORE_DB ? await openLegacyIdbDb(dbName, storeName) : null);
  if (!db) return { removed: 0, reason: `${reason}:no-db` };
  if (!db.objectStoreNames.contains(storeName)) {
    db.close();
    return { removed: 0, reason: `${reason}:no-store` };
  }
  const listed = (await idbGet<string[]>(db, storeName, "?EJS_KEYS!")) ?? [];
  const cursorKeys = await listObjectStoreKeys(db, storeName);
  const keys = new Set([...listed, ...cursorKeys.map((k) => String(k))]);
  let removed = 0;
  for (const key of keys) {
    if (key === "?EJS_KEYS!") continue;
    if (!isEmulatorJsViceCoreStorageKey(key)) continue;
    await removeLegacyObjectStoreKey(db, storeName, key);
    removed++;
  }
  db.close();
  return { removed, reason };
}

/** Delete stale `vice_x64sc*-wasm.data` rows from EmulatorJS-core (cursor + ?EJS_KEYS!). */
export async function purgeEmulatorJsLegacyCoreViceRows(reason = "legacy-core"): Promise<Grok64EjsCachePurgeResult> {
  return purgeViceKeysFromNamedStore(EJS_LEGACY_CORE_DB, EJS_LEGACY_CORE_STORE, reason);
}

/** EmulatorJS-roms / -bios can hold a vice_*.data if a dirty profile stored the core as a ROM. */
export async function purgeEmulatorJsRomBiosViceRows(reason = "rom-bios-core"): Promise<Grok64EjsCachePurgeResult> {
  let removed = 0;
  removed += (await purgeViceKeysFromNamedStore(EJS_ROMS_DB, EJS_ROMS_STORE, `${reason}:roms`)).removed;
  removed += (await purgeViceKeysFromNamedStore(EJS_BIOS_DB, EJS_BIOS_STORE, `${reason}:bios`)).removed;
  removed += (await purgeViceKeysFromNamedStore(EJS_STATES_DB, EJS_STATES_STORE, `${reason}:states`)).removed;
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
  const listed = (await idbGet<string[]>(db, EJS_LEGACY_CORE_STORE, "?EJS_KEYS!")) ?? [];
  const cursorKeys = await listObjectStoreKeys(db, EJS_LEGACY_CORE_STORE);
  const keys = [...new Set([...listed, ...cursorKeys.map((k) => String(k))])];
  const viceRows: Grok64LegacyCoreIdbDiag["viceRows"] = [];
  for (const key of keys) {
    if (!isEmulatorJsViceCoreStorageKey(key)) continue;
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

/**
 * QA: put stock vice *.data bytes in Cache Storage under the current Grok64 URL
 * (dirty profile / SW cache shape). Does not touch the grok64 library DB.
 */
/**
 * QA: poison IDB + Cache Storage with bytes that are not the manifest core
 * (no grok64_disk_attach). Boot purge + refresh must replace this blob.
 */
export async function qaSeedBrokenGrok64CoreCaches(): Promise<{
  idbKey: string;
  cache: string;
  url: string;
  bytes: number;
} | null> {
  if (typeof window === "undefined") return null;
  const canonical = grok64CoreBlobUrl();
  if (!canonical) return null;
  const dummy = new Uint8Array(8192);
  dummy.set(new TextEncoder().encode("STALE-VICE-CORE-NO-GROK64-DISK-ATTACH"));

  if (typeof caches !== "undefined") {
    const cache = await caches.open("grok64-qa-stale-core");
    await cache.put(
      canonical,
      new Response(dummy, { headers: { "Content-Type": "application/octet-stream" } }),
    );
  }

  patchIndexedDbForEmulatorJsCache();
  const db = await openEjsCacheDb();
  let idbKey = "";
  if (db) {
    const key = `Obj-qa-broken-${Date.now()}`;
    const now = Date.now();
    await writeEjsCoreCacheBlob(
      db,
      key,
      {
        key,
        url: canonical,
        type: "Core",
        filename: "vice_x64sc-wasm.data",
        added: now,
        lastAccessed: now,
        fileSize: dummy.byteLength,
        responseType: "arraybuffer",
        cacheExpiry: now + 7 * 86400000,
      },
      "vice_x64sc-wasm.data",
      dummy,
    );
    db.close();
    idbKey = key;
  }

  // Real EmulatorJS-core row keyed by filename — no ?EJS_KEYS! (the eviction miss).
  const copy =
    dummy.byteOffset === 0 && dummy.byteLength === dummy.buffer.byteLength
      ? dummy.buffer
      : dummy.buffer.slice(dummy.byteOffset, dummy.byteOffset + dummy.byteLength);
  const legacy = await openLegacyIdbDb(EJS_LEGACY_CORE_DB);
  if (legacy) {
    let version: unknown = 1;
    try {
      const root = grok64ViceCoreRoot();
      if (root) {
        const reportUrl = `${window.location.origin}${root.startsWith("/") ? root : `/${root}`}/cores/reports/vice_x64sc.json`;
        const reportRes = await fetch(reportUrl, { cache: "no-store" });
        if (reportRes.ok) {
          const rep = (await reportRes.json()) as { buildStart?: unknown };
          if (rep.buildStart != null) version = rep.buildStart;
        }
      }
    } catch {
      /* keep version 1 */
    }
    await idbPut(legacy, EJS_LEGACY_CORE_STORE, "vice_x64sc-wasm.data", { version, data: copy });
    legacy.close();
  }

  return { idbKey, cache: "grok64-qa-stale-core", url: canonical, bytes: dummy.byteLength };
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

/**
 * QA: plant a real pre-disk-export VICE .data in every place a long-used profile
 * can keep it (EmulatorJS-core / roms / bios / states, EmulatorJS-Cache, Cache Storage,
 * canonical + stock + CDN URLs, versioned keys). Does not touch the grok64 library DB.
 */
export async function qaSeedPreDiskExportCoreEverywhere(bytes: Uint8Array): Promise<{
  stores: Record<string, number>;
  cacheEntries: number;
  urls: string[];
  bytes: number;
} | null> {
  if (typeof window === "undefined" || !bytes?.byteLength) return null;
  const root = grok64ViceCoreRoot();
  const origin = window.location.origin;
  const base = root ? `${root.startsWith("/") ? root : `/${root}`}` : "/system/vice/emulatorjs/data";
  const canonical = grok64CoreBlobUrl() ?? `${origin}${base}/cores/${GROK64_IEC_CORE_BLOB}`;
  const stockUrl = `${origin}${base}/cores/vice_x64sc-wasm.data`;
  const urls = [
    canonical,
    stockUrl,
    `${origin}${base}/cores/vice_x64sc-legacy-wasm.data`,
    "https://cdn.emulatorjs.org/stable/data/cores/vice_x64sc-wasm.data",
    "https://cdn.emulatorjs.org/stable/data/cores/vice_x64sc-legacy-wasm.data",
    "https://cdn.emulatorjs.org/stable/data/cores/vice_x64sc-wasm.js",
  ];
  let version: unknown = 1;
  try {
    const reportRes = await fetch(`${origin}${base}/cores/reports/vice_x64sc.json`);
    if (reportRes.ok) {
      const rep = (await reportRes.json()) as { buildStart?: unknown };
      if (rep.buildStart != null) version = rep.buildStart;
    }
  } catch {
    /* keep 1 */
  }

  const data = copyToArrayBuffer(bytes);
  const keys = [
    ...VICE_X64SC_LEGACY_CORE_KEYS,
    GROK64_IEC_CORE_BLOB,
    `vice_x64sc-wasm.data?v=${encodeURIComponent(String(version))}`,
  ];
  const stores: Record<string, number> = {};
  const putLegacy = async (dbName: string, storeName: string) => {
    const db =
      dbName === EJS_LEGACY_CORE_DB
        ? await openLegacyIdbDb(dbName, storeName)
        : ((await openExistingIdb(dbName)) ?? (await openLegacyIdbDb(dbName, storeName)));
    if (!db) {
      stores[dbName] = 0;
      return;
    }
    let n = 0;
    const listed = (await idbGet<string[]>(db, storeName, "?EJS_KEYS!")) ?? [];
    for (const key of keys) {
      await idbPut(db, storeName, key, { version, data });
      if (!listed.includes(key)) listed.push(key);
      n++;
    }
    // Filename-only row with no ?EJS_KEYS! update first (Tom eviction miss), then write keys.
    await idbPut(db, storeName, "vice_x64sc-wasm.data", { version, data });
    await idbPut(db, storeName, "?EJS_KEYS!", listed);
    db.close();
    stores[dbName] = n;
  };
  await putLegacy(EJS_LEGACY_CORE_DB, EJS_LEGACY_CORE_STORE);
  await putLegacy(EJS_ROMS_DB, EJS_ROMS_STORE);
  await putLegacy(EJS_BIOS_DB, EJS_BIOS_STORE);
  await putLegacy(EJS_STATES_DB, EJS_STATES_STORE);

  patchIndexedDbForEmulatorJsCache();
  const cacheDb = await openEjsCacheDb();
  if (cacheDb) {
    let n = 0;
    for (const url of urls.filter((u) => /\.data/i.test(u))) {
      const key = `Obj-qa-pre-export-${n}-${Date.now()}`;
      const now = Date.now();
      await writeEjsCoreCacheBlob(
        cacheDb,
        key,
        {
          key,
          url,
          type: "Core",
          filename: "vice_x64sc-wasm.data",
          added: now,
          lastAccessed: now,
          fileSize: bytes.byteLength,
          responseType: "arraybuffer",
          cacheExpiry: now + 7 * 86400000,
        },
        "vice_x64sc-wasm.data",
        bytes,
      );
      n++;
    }
    cacheDb.close();
    stores[EJS_CACHE_DB] = n;
  }

  let cacheEntries = 0;
  if (typeof caches !== "undefined") {
    const names = ["grok64-qa-stale-core", "EmulatorJS", "workbox-precache", "ejs-core"];
    const body = new Uint8Array(bytes);
    for (const name of names) {
      const cache = await caches.open(name);
      for (const url of urls) {
        await cache.put(url, new Response(body, { headers: { "Content-Type": "application/octet-stream" } }));
        cacheEntries++;
      }
    }
  }

  try {
    sessionStorage.setItem(AUTO_RELOAD_SS, "2");
    sessionStorage.setItem(STICKY_SS, "1");
    sessionStorage.setItem(LAST_FETCH_SS, String(GROK64_CORE_BYTES || bytes.byteLength));
    sessionStorage.removeItem(HEAL_PENDING_SS);
    sessionStorage.removeItem("g64-crash-play");
    sessionStorage.removeItem("g64-live-play");
  } catch {
    /* ignore */
  }

  return { stores, cacheEntries, urls, bytes: bytes.byteLength };
}

export async function qaSeedStaleGrok64CoreCacheStorage(): Promise<{
  cache: string;
  url: string;
  bytes: number;
} | null> {
  if (typeof caches === "undefined" || typeof window === "undefined") return null;
  const root = grok64ViceCoreRoot();
  if (!root) return null;
  const rel = `${root.startsWith("/") ? root : `/${root}`}/cores/vice_x64sc-wasm.data`;
  const stockUrl = `${window.location.origin}${rel}`;
  const res = await fetch(stockUrl, { cache: "no-store" });
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  const canonical = grok64CoreBlobUrl();
  if (!canonical) return null;
  const cacheName = "grok64-qa-stale-core";
  const cache = await caches.open(cacheName);
  await cache.put(
    canonical,
    new Response(buf, { headers: { "Content-Type": "application/octet-stream" } }),
  );
  return { cache: cacheName, url: canonical, bytes: buf.byteLength };
}

/**
 * `coreStarted: false` when only the glue has been seen (EmulatorJS `initGameCore`): the WASM is not
 * instantiated yet, so missing exports say nothing about staleness and must not force a reload.
 *
 * A running core with no `grok64_disk_attach` always refreshes (Tom dirty-profile case), even when
 * glue was never recorded. Sticky only after a real manifest-sized fetch still lacks exports.
 */
/** Heal reloads removed — stale cores are blocked by manifest `buildStart` + local IEC serve. */
export async function maybeAutoRefreshStaleEmulatorCore(
  _emu: { Module?: unknown } | null,
  _opts: { coreStarted?: boolean } = {},
): Promise<boolean> {
  return false;
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
    if (isEmulatorJsViceCoreStorageKey(String(key))) return undefined;
    return origGet(key);
  };
  if (core.put) {
    const origPut = core.put.bind(core);
    core.put = async (key: string, data: unknown) => {
      if (isEmulatorJsViceCoreStorageKey(String(key))) return;
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
  patchEmulatorJsStorageViceCoreBypass();

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
