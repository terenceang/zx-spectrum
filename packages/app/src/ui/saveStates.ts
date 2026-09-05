import type { MachineModel } from "@zx-spectrum/core";
import { idbRequest, idbTx, openDb } from "../utils/idb.js";

const DB_NAME = "zx_save_states";
const STORE_NAME = "states";

export interface SaveStateEntry {
  id: string;
  slot: number;
  model: MachineModel;
  timestamp: number;
  data: ArrayBuffer;
  screenshot: string;
  name?: string | undefined;
  format?: "sna" | "z80" | undefined;
}

function stateDb(): Promise<IDBDatabase> {
  return openDb(DB_NAME, STORE_NAME, { keyPath: "id" });
}

export function stateId(model: MachineModel, slot: number): string {
  return `${model}_slot_${slot}`;
}

export async function saveStateToStorage(
  slot: number,
  model: MachineModel,
  data: ArrayBuffer,
  screenshot: string,
  name?: string,
  format?: "sna" | "z80",
): Promise<void> {
  const db = await stateDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const entry: SaveStateEntry = {
    id: stateId(model, slot),
    slot,
    model,
    timestamp: Date.now(),
    data,
    screenshot,
    name,
    format,
  };
  tx.objectStore(STORE_NAME).put(entry);
  return idbTx(tx);
}

export async function loadStateFromStorage(
  slot: number,
  model: MachineModel,
): Promise<SaveStateEntry | null> {
  const db = await stateDb();
  const tx = db.transaction(STORE_NAME, "readonly");
  const result = await idbRequest<SaveStateEntry | undefined>(
    tx.objectStore(STORE_NAME).get(stateId(model, slot)),
  );
  return result ?? null;
}

export async function deleteStateFromStorage(slot: number, model: MachineModel): Promise<void> {
  const db = await stateDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).delete(stateId(model, slot));
  return idbTx(tx);
}

export async function getAllSaveStates(model?: MachineModel): Promise<SaveStateEntry[]> {
  const db = await stateDb();
  const tx = db.transaction(STORE_NAME, "readonly");
  const all = await idbRequest<SaveStateEntry[]>(tx.objectStore(STORE_NAME).getAll());
  if (model) {
    return all.filter((s) => s.model === model);
  }
  return all;
}
