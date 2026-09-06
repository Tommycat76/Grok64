const DB_NAME = "grok64";
const DB_VERSION = 3;

export const STORES = {
  files: "files",
  states: "states",
  roms: "roms",
  sdpart: "sdpart",
  snaps: "snaps",
} as const;

export function openExpansionDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.files)) {
        db.createObjectStore(STORES.files, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.states)) {
        db.createObjectStore(STORES.states, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.roms)) {
        db.createObjectStore(STORES.roms, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.sdpart)) {
        db.createObjectStore(STORES.sdpart, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.snaps)) {
        db.createObjectStore(STORES.snaps, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
