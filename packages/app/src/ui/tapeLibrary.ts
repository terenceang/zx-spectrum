export type TapeFormat = "tap" | "tzx";

export interface TapeEntry {
  id: string;
  name: string;
  filename: string;
  format: TapeFormat;
  data: ArrayBuffer;
  addedAt: number;
}

const DB_NAME = "zx-spectrum-tapes";
const STORE_NAME = "tapes";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function addTape(
  tape: Omit<TapeEntry, "id" | "addedAt">,
): Promise<TapeEntry> {
  const entry: TapeEntry = {
    ...tape,
    id: generateId(),
    addedAt: Date.now(),
  };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return entry;
}

export async function removeTape(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getAllTapes(): Promise<TapeEntry[]> {
  const db = await openDb();
  const result = await new Promise<TapeEntry[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as TapeEntry[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result.sort((a, b) => b.addedAt - a.addedAt);
}

export async function getTape(id: string): Promise<TapeEntry | null> {
  const db = await openDb();
  const result = await new Promise<TapeEntry | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve((request.result as TapeEntry) ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

export async function renameTape(id: string, name: string): Promise<void> {
  const entry = await getTape(id);
  if (!entry) return;
  entry.name = name;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
