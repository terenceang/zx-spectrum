/** Caches the loaded ROM and Tape/Snapshot in IndexedDB so that refreshing the
 * page restores the machine and media state with full UI reflection. */

export interface StoredRom {
  model: "48k" | "128k";
  filename: string;
  data: ArrayBuffer;
}

export interface StoredMedia {
  filename: string;
  format: "sna" | "z80" | "tap" | "tzx";
  data: ArrayBuffer;
}

const DB_NAME = "zx-spectrum-session";
const STORE_NAME = "session";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveSessionRom(rom: StoredRom): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(rom, `rom_${rom.model}`);
    tx.objectStore(STORE_NAME).put(rom.model, "last_model");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadSessionRom(model: "48k" | "128k"): Promise<StoredRom | null> {
  const db = await openDb();
  const result = await new Promise<StoredRom | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(`rom_${model}`);
    request.onsuccess = () => resolve((request.result as StoredRom | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

export async function saveSessionMedia(media: StoredMedia | null): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    if (media) {
      tx.objectStore(STORE_NAME).put(media, "last_media");
    } else {
      tx.objectStore(STORE_NAME).delete("last_media");
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadSessionMedia(): Promise<StoredMedia | null> {
  const db = await openDb();
  const result = await new Promise<StoredMedia | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get("last_media");
    request.onsuccess = () => resolve((request.result as StoredMedia | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

export async function saveLastModel(model: "48k" | "128k"): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(model, "last_model");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadLastModel(): Promise<"48k" | "128k" | null> {
  const db = await openDb();
  const result = await new Promise<"48k" | "128k" | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get("last_model");
    request.onsuccess = () => resolve((request.result as "48k" | "128k" | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}
