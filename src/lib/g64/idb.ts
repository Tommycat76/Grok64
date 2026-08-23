import { kindOf, isWorkDisk } from "./files";
import type { LibraryItem } from "./store";

const DB = "grok64";
const FILES = "files";
const STATES = "states";
export const WORK_DISK = "WORK DISK.D64";

interface StoredFile extends LibraryItem {
  data: ArrayBuffer;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STATES)) db.createObjectStore(STATES, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function waitTx(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function listLibrary(): Promise<LibraryItem[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(FILES, "readonly").objectStore(FILES).getAll();
    req.onsuccess = () => {
      const rows = (req.result as StoredFile[]).map(({ data: _d, ...meta }) => meta);
      rows.sort((a, b) => (b.lastPlayed ?? b.addedAt) - (a.lastPlayed ?? a.addedAt));
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getFile(id: string): Promise<StoredFile | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(FILES, "readonly").objectStore(FILES).get(id);
    req.onsuccess = () => resolve((req.result as StoredFile) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function putFile(name: string, data: ArrayBuffer, source: string): Promise<LibraryItem> {
  const row: StoredFile = {
    id: crypto.randomUUID(),
    name,
    kind: kindOf(name),
    source,
    size: data.byteLength,
    addedAt: Date.now(),
    data,
  };
  const tx = (await openDb()).transaction(FILES, "readwrite");
  tx.objectStore(FILES).put(row);
  await waitTx(tx);
  const { data: _d, ...meta } = row;
  return meta;
}

export async function updateFileData(id: string, data: ArrayBuffer) {
  const row = await getFile(id);
  if (!row) return;
  row.data = data;
  row.size = data.byteLength;
  const tx = (await openDb()).transaction(FILES, "readwrite");
  tx.objectStore(FILES).put(row);
  await waitTx(tx);
}

export async function touchPlayed(id: string) {
  const row = await getFile(id);
  if (!row) return;
  row.lastPlayed = Date.now();
  const tx = (await openDb()).transaction(FILES, "readwrite");
  tx.objectStore(FILES).put(row);
  await waitTx(tx);
}

export async function deleteFile(id: string) {
  const tx = (await openDb()).transaction([FILES, STATES], "readwrite");
  tx.objectStore(FILES).delete(id);
  tx.objectStore(STATES).delete(id);
  await waitTx(tx);
}

export async function deleteState(id: string) {
  const tx = (await openDb()).transaction(STATES, "readwrite");
  tx.objectStore(STATES).delete(id);
  await waitTx(tx);
}

export function isWorkDiskName(name: string) {
  return name.toUpperCase() === WORK_DISK;
}

export async function ensureWorkDisk() {
  const all = await listLibrary();
  const existing = all.find((f) => f.name.toUpperCase() === WORK_DISK);
  if (existing) return existing;
  const res = await fetch("/software/blank.d64");
  if (!res.ok) throw new Error("Could not create a work disk");
  return putFile(WORK_DISK, await res.arrayBuffer(), "local");
}

export async function putState(id: string, data: ArrayBuffer, title: string) {
  const tx = (await openDb()).transaction(STATES, "readwrite");
  tx.objectStore(STATES).put({ id, data, title, savedAt: Date.now() });
  await waitTx(tx);
}

export async function getState(id: string): Promise<ArrayBuffer | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STATES, "readonly").objectStore(STATES).get(id);
    req.onsuccess = () => resolve((req.result as { data?: ArrayBuffer } | undefined)?.data ?? null);
    req.onerror = () => reject(req.error);
  });
}

export { isWorkDisk };
