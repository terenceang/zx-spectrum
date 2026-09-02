/** Caches the loaded Tape/Snapshot in IndexedDB so that refreshing the
 * page restores the machine and media state with full UI reflection. */

import type { MediaFormat } from "@zx-spectrum/core";

export interface StoredMedia {
  filename: string;
  format: MediaFormat;
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
