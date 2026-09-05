import { idbRequest, idbTx, openDb } from "../utils/idb.js";

export type TapeFormat = "tap" | "tzx";

export interface TapeEntry {
  id: string;
  name: string;
  filename: string;
  format: TapeFormat;
  machine?: "48k" | "128k" | "plus3" | "all";
  data: ArrayBuffer;
  addedAt: number;
}

const DB_NAME = "zx-spectrum-tapes";
const STORE_NAME = "tapes";

function openTapesDb(): Promise<IDBDatabase> {
  return openDb(DB_NAME, STORE_NAME, { keyPath: "id" });
}

export async function addTape(
  tape: Omit<TapeEntry, "id" | "addedAt">,
): Promise<TapeEntry> {
  const entry: TapeEntry = {
    ...tape,
    id: crypto.randomUUID(),
    addedAt: Date.now(),
  };
  const db = await openTapesDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).put(entry);
  await idbTx(tx);
  db.close();
  return entry;
}

export async function removeTape(id: string): Promise<void> {
  const db = await openTapesDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).delete(id);
  await idbTx(tx);
  db.close();
}

export async function removeTapes(ids: string[]): Promise<void> {
  const db = await openTapesDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  for (const id of ids) store.delete(id);
  await idbTx(tx);
  db.close();
}

export async function getAllTapes(): Promise<TapeEntry[]> {
  const db = await openTapesDb();
  const tx = db.transaction(STORE_NAME, "readonly");
  const result = await idbRequest<TapeEntry[]>(tx.objectStore(STORE_NAME).getAll());
  db.close();
  return result.sort((a, b) => b.addedAt - a.addedAt);
}

export async function getTape(id: string): Promise<TapeEntry | null> {
  const db = await openTapesDb();
  const tx = db.transaction(STORE_NAME, "readonly");
  const result = await idbRequest<TapeEntry | undefined>(tx.objectStore(STORE_NAME).get(id));
  db.close();
  return result ?? null;
}

export async function renameTape(id: string, name: string): Promise<void> {
  const entry = await getTape(id);
  if (!entry) return;
  entry.name = name;
  const db = await openTapesDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).put(entry);
  await idbTx(tx);
  db.close();
}
