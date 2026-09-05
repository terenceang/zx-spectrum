import type { MediaFormat } from "@zx-spectrum/core";
import { idbRequest, idbTx, openDb } from "../utils/idb.js";

export interface StoredMedia {
  filename: string;
  format: MediaFormat;
  data: ArrayBuffer;
}

const DB_NAME = "zx-spectrum-session";
const STORE_NAME = "session";

export async function saveSessionMedia(media: StoredMedia | null): Promise<void> {
  const db = await openDb(DB_NAME, STORE_NAME);
  const tx = db.transaction(STORE_NAME, "readwrite");
  if (media) {
    tx.objectStore(STORE_NAME).put(media, "last_media");
  } else {
    tx.objectStore(STORE_NAME).delete("last_media");
  }
  await idbTx(tx);
  db.close();
}

export async function loadSessionMedia(): Promise<StoredMedia | null> {
  const db = await openDb(DB_NAME, STORE_NAME);
  const tx = db.transaction(STORE_NAME, "readonly");
  const result = await idbRequest(tx.objectStore(STORE_NAME).get("last_media"));
  db.close();
  return (result as StoredMedia | undefined) ?? null;
}
