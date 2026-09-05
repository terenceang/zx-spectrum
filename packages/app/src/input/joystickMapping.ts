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

export const JOYSTICK_KEY_MAP: Record<
  Exclude<JoystickType, "none" | "kempston">,
  Record<JoystickDirection, MatrixKey>
> = {
  sinclair1: {
    left: { row: 3, bit: 0 },
    right: { row: 3, bit: 1 },
    down: { row: 3, bit: 2 },
    up: { row: 3, bit: 3 },
    fire: { row: 3, bit: 4 },
  },
  sinclair2: {
    fire: { row: 4, bit: 0 },
    up: { row: 4, bit: 1 },
    down: { row: 4, bit: 2 },
    right: { row: 4, bit: 3 },
    left: { row: 4, bit: 4 },
  },
  cursor: {
    left: { row: 3, bit: 4 },
    down: { row: 4, bit: 4 },
    up: { row: 4, bit: 3 },
    right: { row: 4, bit: 2 },
    fire: { row: 4, bit: 0 },
  },
  qaop: {
    up: { row: 2, bit: 0 },
    down: { row: 1, bit: 0 },
    left: { row: 5, bit: 1 },
    right: { row: 5, bit: 0 },
    fire: { row: 7, bit: 0 },
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
  } catch {}
  return { ...DEFAULT_JOYSTICK_KEY_BINDINGS };
}

export function saveJoystickKeyBindings(bindings: Record<JoystickDirection, string>): void {
  localStorage.setItem(BINDINGS_STORAGE_KEY, JSON.stringify(bindings));
}
