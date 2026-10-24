/** Read-only diagnostics for the `grok64` library IndexedDB (never mutated by EJS cache hygiene). */
import { GROK64_LIBRARY_DB } from "./grok64-ejs-core-cache";
import { listLibrary } from "./library";

const STORE = "files";

export type Grok64LibraryIdbDiag = {
  dbName: string;
  openOk: boolean;
  storePresent: boolean;
  rowCount: number;
  names: string[];
  error: string | null;
};

export async function grok64LibraryIdbDiag(): Promise<Grok64LibraryIdbDiag> {
  const base: Grok64LibraryIdbDiag = {
    dbName: GROK64_LIBRARY_DB,
    openOk: false,
    storePresent: false,
    rowCount: 0,
    names: [],
    error: null,
  };
  try {
    const items = await listLibrary();
    base.openOk = true;
    base.storePresent = true;
    base.rowCount = items.length;
    base.names = items.map((i) => i.name).slice(0, 32);
    return base;
  } catch (e) {
    base.error = e instanceof Error ? e.message : String(e);
  }

  if (typeof indexedDB === "undefined") return base;

  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(GROK64_LIBRARY_DB);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    base.openOk = true;
    base.storePresent = db.objectStoreNames.contains(STORE);
    db.close();
  } catch (e) {
    base.error = base.error ?? (e instanceof Error ? e.message : String(e));
  }
  return base;
}
