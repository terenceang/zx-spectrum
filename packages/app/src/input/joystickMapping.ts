/** Emulated joystick hardware types. "kempston" reads as a real I/O port (see
 * core's JoystickState); the rest are just specific keys on the Spectrum matrix,
 * so they route through the normal key-event path instead. */
import type { KempstonInput } from "../../../worker/src/protocol.js";
import type { MatrixKey } from "./keyMapping.js";

export type JoystickType = "none" | "kempston" | "sinclair1" | "sinclair2" | "cursor" | "qaop";
export type JoystickDirection = KempstonInput;

export const JOYSTICK_TYPES: { value: JoystickType; label: string }[] = [
  { value: "none", label: "None" },
  { value: "kempston", label: "Kempston" },
  { value: "sinclair1", label: "Sinclair 1 (keys 1-5)" },
  { value: "sinclair2", label: "Sinclair 2 (keys 6-0)" },
  { value: "cursor", label: "Cursor (keys 5,6,7,8,0)" },
  { value: "qaop", label: "QAOP + Space" },
];

/** Matrix key each direction presses for the keyboard-emulated joystick types.
 * Kempston has no entry here — it goes through sendJoystick() instead. */
export const JOYSTICK_KEY_MAP: Record<Exclude<JoystickType, "none" | "kempston">, Record<JoystickDirection, MatrixKey>> = {
  sinclair1: {
    left: { row: 3, bit: 0 }, // 1
    right: { row: 3, bit: 1 }, // 2
    down: { row: 3, bit: 2 }, // 3
    up: { row: 3, bit: 3 }, // 4
    fire: { row: 3, bit: 4 }, // 5
  },
  sinclair2: {
    fire: { row: 4, bit: 0 }, // 0
    up: { row: 4, bit: 1 }, // 9
    down: { row: 4, bit: 2 }, // 8
    right: { row: 4, bit: 3 }, // 7
    left: { row: 4, bit: 4 }, // 6
  },
  cursor: {
    left: { row: 3, bit: 4 }, // 5
    down: { row: 4, bit: 4 }, // 6
    up: { row: 4, bit: 3 }, // 7
    right: { row: 4, bit: 2 }, // 8
    fire: { row: 4, bit: 0 }, // 0
  },
  qaop: {
    up: { row: 2, bit: 0 }, // Q
    down: { row: 1, bit: 0 }, // A
    left: { row: 5, bit: 1 }, // O
    right: { row: 5, bit: 0 }, // P
    fire: { row: 7, bit: 0 }, // Space
  },
};

export const JOYSTICK_DIRECTIONS: JoystickDirection[] = ["up", "down", "left", "right", "fire"];

export const DEFAULT_JOYSTICK_KEY_BINDINGS: Record<JoystickDirection, string> = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  fire: "Space",
};

const TYPE_STORAGE_KEY = "zx_spectrum_joystick_type";
const BINDINGS_STORAGE_KEY = "zx_spectrum_joystick_bindings";

export function loadJoystickType(): JoystickType {
  const stored = localStorage.getItem(TYPE_STORAGE_KEY);
  return JOYSTICK_TYPES.some((t) => t.value === stored) ? (stored as JoystickType) : "none";
}

export function saveJoystickType(type: JoystickType): void {
  localStorage.setItem(TYPE_STORAGE_KEY, type);
}

export function loadJoystickKeyBindings(): Record<JoystickDirection, string> {
  try {
    const stored = JSON.parse(localStorage.getItem(BINDINGS_STORAGE_KEY) ?? "null");
    if (stored && JOYSTICK_DIRECTIONS.every((d) => typeof stored[d] === "string")) {
      return stored;
    }
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULT_JOYSTICK_KEY_BINDINGS };
}

export function saveJoystickKeyBindings(bindings: Record<JoystickDirection, string>): void {
  localStorage.setItem(BINDINGS_STORAGE_KEY, JSON.stringify(bindings));
}
