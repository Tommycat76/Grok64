import type { LibraryItem, StoredFile } from "./types";
import { kindOf } from "./formats";

const DB_NAME = "grok64";
const STORE = "files";
const STATES = "states";

export const WORK_DISK_NAME = "WORK DISK.D64";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STATES)) {
        db.createObjectStore(STATES, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function listLibrary(): Promise<LibraryItem[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
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
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as StoredFile) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function putFile(
  name: string,
  data: ArrayBuffer,
  source: StoredFile["source"],
): Promise<LibraryItem> {
  const item: StoredFile = {
    id: crypto.randomUUID(),
    name,
    kind: kindOf(name),
    source,
    size: data.byteLength,
    addedAt: Date.now(),
    data,
  };
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(item);
  await txDone(tx);
  const { data: _d, ...meta } = item;
  return meta;
}

export async function updateFileData(id: string, data: ArrayBuffer): Promise<void> {
  const file = await getFile(id);
  if (!file) return;
  file.data = data;
  file.size = data.byteLength;
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(file);
  await txDone(tx);
}

export async function putSaveState(id: string, data: ArrayBuffer, title?: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STATES, "readwrite");
  tx.objectStore(STATES).put({ id, data, savedAt: Date.now(), title: title ?? "" });
  await txDone(tx);
}

export interface SaveRecord {
  data: ArrayBuffer;
  title?: string;
  savedAt?: number;
}

export async function getSaveRecord(id: string): Promise<SaveRecord | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STATES, "readonly").objectStore(STATES).get(id);
    req.onsuccess = () => {
      const row = req.result as SaveRecord | undefined;
      if (!row?.data) {
        resolve(null);
        return;
      }
      resolve({ data: row.data, title: row.title, savedAt: row.savedAt });
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getSaveState(id: string): Promise<ArrayBuffer | null> {
  const rec = await getSaveRecord(id);
  return rec?.data ?? null;
}

export async function deleteSaveState(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STATES, "readwrite");
  tx.objectStore(STATES).delete(id);
  await txDone(tx);
}


export async function touchPlayed(id: string): Promise<void> {
  const file = await getFile(id);
  if (!file) return;
  file.lastPlayed = Date.now();
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(file);
  await txDone(tx);
}

export async function removeFile(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([STORE, STATES], "readwrite");
  tx.objectStore(STORE).delete(id);
  tx.objectStore(STATES).delete(id);
  await txDone(tx);
}

export async function readBlob(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}

export function copyBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (data instanceof Uint8Array) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  }
  return data.slice(0);
}

export function isWorkDisk(name: string): boolean {
  return name.toUpperCase() === WORK_DISK_NAME;
}

export async function ensureWorkDisk(): Promise<LibraryItem> {
  const items = await listLibrary();
  const found = items.find((i) => i.name.toUpperCase() === WORK_DISK_NAME);
  if (found) return found;
  const res = await fetch("/software/blank.d64");
  if (!res.ok) throw new Error("Could not create a work disk");
  const buf = await res.arrayBuffer();
  return putFile(WORK_DISK_NAME, buf, "local");
}
