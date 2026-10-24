/**
 * About / QA: log *.data fetches and enumerate SW, Cache Storage, IndexedDB.
 */
import { GROK64_IEC_CORE_BLOB } from "./grok64-ejs-core-cache";

export type Grok64DataFetchLogEntry = {
  kind: "fetch" | "xhr";
  url: string;
  at: number;
};

export type Grok64IdbStoreDiag = {
  name: string;
  keyCount: number;
  sampleKeys: string[];
};

export type Grok64IdbDatabaseDiag = {
  name: string;
  version?: number;
  stores: Grok64IdbStoreDiag[];
  error?: string;
};

export type Grok64CacheEnvironmentDiag = {
  cacheStorageKeys: string[];
  serviceWorkers: { scope: string; scriptURL: string; state: string }[];
  dataFetches: Grok64DataFetchLogEntry[];
  indexedDatabases: Grok64IdbDatabaseDiag[];
};

const FETCH_LOG_KEY = "__GROK64_DATA_FETCH_LOG__";
const MAX_FETCH_LOG = 40;

function isWasmDataUrl(url: string): boolean {
  return url.includes(".data") || /\/cores\/vice_.*wasm\.data/i.test(url) || url.includes(GROK64_IEC_CORE_BLOB);
}

function pushFetchLog(kind: Grok64DataFetchLogEntry["kind"], url: string) {
  if (typeof window === "undefined" || !isWasmDataUrl(url)) return;
  const w = window as unknown as Record<string, Grok64DataFetchLogEntry[]>;
  if (!w[FETCH_LOG_KEY]) w[FETCH_LOG_KEY] = [];
  const log = w[FETCH_LOG_KEY];
  log.push({ kind, url, at: Date.now() });
  if (log.length > MAX_FETCH_LOG) log.splice(0, log.length - MAX_FETCH_LOG);
}

export function patchGrok64DataFetchInstrumentation(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __g64DataFetchInst?: boolean };
  if (w.__g64DataFetchInst) return;
  w.__g64DataFetchInst = true;

  const origFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input instanceof Request
            ? input.url
            : "";
    pushFetchLog("fetch", url);
    return origFetch(input, init);
  };

  const XHR = window.XMLHttpRequest;
  if (XHR?.prototype?.open) {
    const origOpen = XHR.prototype.open;
    XHR.prototype.open = function patchedOpen(
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      pushFetchLog("xhr", String(url));
      return origOpen.call(
        this,
        method,
        url,
        ...(rest as [boolean, string | undefined, string | undefined]),
      );
    };
  }
}

export function grok64DataFetchLog(): Grok64DataFetchLogEntry[] {
  if (typeof window === "undefined") return [];
  return (
    ((window as unknown as Record<string, Grok64DataFetchLogEntry[]>)[FETCH_LOG_KEY] as Grok64DataFetchLogEntry[]) ??
    []
  );
}

async function listIdbStoreKeys(dbName: string, storeName: string, limit = 24): Promise<Grok64IdbStoreDiag> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(dbName);
      req.onerror = () => resolve({ name: storeName, keyCount: 0, sampleKeys: [] });
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.close();
          resolve({ name: storeName, keyCount: 0, sampleKeys: [] });
          return;
        }
        const tx = db.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        const keys: string[] = [];
        let count = 0;
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) {
            db.close();
            resolve({ name: storeName, keyCount: count, sampleKeys: keys });
            return;
          }
          count++;
          if (keys.length < limit) {
            const k = cursor.key;
            keys.push(typeof k === "string" ? k : JSON.stringify(k));
          }
          cursor.continue();
        };
        cursorReq.onerror = () => {
          db.close();
          resolve({ name: storeName, keyCount: count, sampleKeys: keys });
        };
      };
    } catch {
      resolve({ name: storeName, keyCount: 0, sampleKeys: [] });
    }
  });
}

async function diagOneIdbDatabase(name: string): Promise<Grok64IdbDatabaseDiag> {
  const out: Grok64IdbDatabaseDiag = { name, stores: [] };
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(name);
      req.onerror = () => {
        out.error = "open-failed";
        resolve(out);
      };
      req.onsuccess = async () => {
        const db = req.result;
        out.version = db.version;
        const storeNames = Array.from(db.objectStoreNames);
        db.close();
        for (const sn of storeNames) {
          out.stores.push(await listIdbStoreKeys(name, sn));
        }
        resolve(out);
      };
    } catch (e) {
      out.error = String(e);
      resolve(out);
    }
  });
}

export async function grok64CacheEnvironmentDiag(): Promise<Grok64CacheEnvironmentDiag> {
  const cacheStorageKeys: string[] = [];
  try {
    if (typeof caches !== "undefined") {
      cacheStorageKeys.push(...(await caches.keys()));
    }
  } catch {
    /* ignore */
  }

  const serviceWorkers: Grok64CacheEnvironmentDiag["serviceWorkers"] = [];
  try {
    if (typeof navigator !== "undefined" && navigator.serviceWorker?.getRegistrations) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) {
        serviceWorkers.push({
          scope: r.scope,
          scriptURL: r.active?.scriptURL ?? r.installing?.scriptURL ?? r.waiting?.scriptURL ?? "",
          state: r.active?.state ?? r.installing?.state ?? r.waiting?.state ?? "unknown",
        });
      }
    }
  } catch {
    /* ignore */
  }

  const indexedDatabases: Grok64IdbDatabaseDiag[] = [];
  try {
    if (typeof indexedDB !== "undefined" && indexedDB.databases) {
      const list = await indexedDB.databases();
      for (const row of list) {
        if (!row.name) continue;
        indexedDatabases.push(await diagOneIdbDatabase(row.name));
      }
    }
  } catch {
    /* ignore */
  }

  return {
    cacheStorageKeys,
    serviceWorkers,
    dataFetches: grok64DataFetchLog(),
    indexedDatabases,
  };
}
