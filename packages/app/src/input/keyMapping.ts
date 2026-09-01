/** Physical PC key -> Spectrum 8x5 matrix coordinates. Row/bit numbers match the
 * real hardware matrix (row 0 = port 0xFEFE's row, etc.) — this is app-layer
 * concern per the plan: core only knows about the raw matrix, translating a
 * specific input device's keys into matrix coordinates is a UI job and differs for
 * touch/gamepad inputs, which get their own mapping tables later. */

const CAPS_SHIFT = { row: 0, bit: 0 };
const SYMBOL_SHIFT = { row: 7, bit: 1 };

type MatrixKey = { row: number; bit: number };

/** Most keys map to exactly one matrix position; arrow keys and a few punctuation
 * keys are CAPS-SHIFT/SYMBOL-SHIFT combos on real Spectrum keyboards and map to two. */
export const KEY_MAP: Record<string, MatrixKey[]> = {
  ShiftLeft: [CAPS_SHIFT],
  ShiftRight: [CAPS_SHIFT],
  KeyZ: [{ row: 0, bit: 1 }],
  KeyX: [{ row: 0, bit: 2 }],
  KeyC: [{ row: 0, bit: 3 }],
  KeyV: [{ row: 0, bit: 4 }],
  KeyA: [{ row: 1, bit: 0 }],
  KeyS: [{ row: 1, bit: 1 }],
  KeyD: [{ row: 1, bit: 2 }],
  KeyF: [{ row: 1, bit: 3 }],
  KeyG: [{ row: 1, bit: 4 }],
  KeyQ: [{ row: 2, bit: 0 }],
  KeyW: [{ row: 2, bit: 1 }],
  KeyE: [{ row: 2, bit: 2 }],
  KeyR: [{ row: 2, bit: 3 }],
  KeyT: [{ row: 2, bit: 4 }],
  Digit1: [{ row: 3, bit: 0 }],
  Digit2: [{ row: 3, bit: 1 }],
  Digit3: [{ row: 3, bit: 2 }],
  Digit4: [{ row: 3, bit: 3 }],
  Digit5: [{ row: 3, bit: 4 }],
  Digit0: [{ row: 4, bit: 0 }],
  Digit9: [{ row: 4, bit: 1 }],
  Digit8: [{ row: 4, bit: 2 }],
  Digit7: [{ row: 4, bit: 3 }],
  Digit6: [{ row: 4, bit: 4 }],
  KeyP: [{ row: 5, bit: 0 }],
  KeyO: [{ row: 5, bit: 1 }],
  KeyI: [{ row: 5, bit: 2 }],
  KeyU: [{ row: 5, bit: 3 }],
  KeyY: [{ row: 5, bit: 4 }],
  Enter: [{ row: 6, bit: 0 }],
  KeyL: [{ row: 6, bit: 1 }],
  KeyK: [{ row: 6, bit: 2 }],
  KeyJ: [{ row: 6, bit: 3 }],
  KeyH: [{ row: 6, bit: 4 }],
  Space: [{ row: 7, bit: 0 }],
  ControlLeft: [SYMBOL_SHIFT],
  ControlRight: [SYMBOL_SHIFT],
  AltRight: [SYMBOL_SHIFT],
  KeyM: [{ row: 7, bit: 2 }],
  KeyN: [{ row: 7, bit: 3 }],
  KeyB: [{ row: 7, bit: 4 }],

  // Arrow keys and delete are CAPS-SHIFT combos on real hardware.
  ArrowLeft: [CAPS_SHIFT, { row: 3, bit: 4 }], // CAPS SHIFT + 5
  ArrowDown: [CAPS_SHIFT, { row: 4, bit: 4 }], // CAPS SHIFT + 6
  ArrowUp: [CAPS_SHIFT, { row: 4, bit: 3 }], // CAPS SHIFT + 7
  ArrowRight: [CAPS_SHIFT, { row: 4, bit: 2 }], // CAPS SHIFT + 8
  Backspace: [CAPS_SHIFT, { row: 4, bit: 0 }], // CAPS SHIFT + 0 (DELETE)
};
