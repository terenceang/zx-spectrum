import type { MachineModel } from "@zx-spectrum/core";
import { arrayBufferToBase64, base64ToArrayBuffer } from "../utils/base64.js";

const ROM_KEY_48K = "zx_spectrum_rom_48k";
const ROM_KEY_128K = "zx_spectrum_rom_128k";
const LAST_MODEL_KEY = "zx_spectrum_last_model";

function romKey(model: MachineModel): string {
  return model === "48k" ? ROM_KEY_48K : ROM_KEY_128K;
}

export interface StoredRom {
  model: MachineModel;
  filename: string;
  data: ArrayBuffer;
}

export function saveRom(rom: StoredRom): void {
  const payload = JSON.stringify({
    model: rom.model,
    filename: rom.filename,
    data: arrayBufferToBase64(rom.data),
  });
  localStorage.setItem(romKey(rom.model), payload);
  localStorage.setItem(LAST_MODEL_KEY, rom.model);
}

export function loadRom(model: MachineModel): StoredRom | null {
  const raw = localStorage.getItem(romKey(model));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { model: MachineModel; filename: string; data: string };
    return {
      model: parsed.model,
      filename: parsed.filename,
      data: base64ToArrayBuffer(parsed.data),
    };
  } catch {
    return null;
  }
}

export function loadLastModel(): MachineModel | null {
  const val = localStorage.getItem(LAST_MODEL_KEY);
  if (val === "48k" || val === "128k") return val;
  return null;
}

export function hasRom(model: MachineModel): boolean {
  return localStorage.getItem(romKey(model)) !== null;
}
