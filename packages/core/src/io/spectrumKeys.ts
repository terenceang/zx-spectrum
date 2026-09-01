/** The ZX Spectrum's 8x5 hardware key matrix, by the label printed on each key —
 * a fact about the machine itself, not about any particular input device. See
 * packages/app/src/input/keyMapping.ts for the browser-keyboard-specific
 * translation (DOM `KeyboardEvent.code` -> these same row/bit coordinates), which
 * is a UI-layer concern and stays there. */
export type MatrixKey = { row: number; bit: number };

export const CAPS_SHIFT: MatrixKey = { row: 0, bit: 0 };
export const SYMBOL_SHIFT: MatrixKey = { row: 7, bit: 1 };

export const SPECTRUM_KEY_MATRIX: Record<string, MatrixKey> = {
  CAPS_SHIFT,
  SYMBOL_SHIFT,
  Z: { row: 0, bit: 1 },
  X: { row: 0, bit: 2 },
  C: { row: 0, bit: 3 },
  V: { row: 0, bit: 4 },
  A: { row: 1, bit: 0 },
  S: { row: 1, bit: 1 },
  D: { row: 1, bit: 2 },
  F: { row: 1, bit: 3 },
  G: { row: 1, bit: 4 },
  Q: { row: 2, bit: 0 },
  W: { row: 2, bit: 1 },
  E: { row: 2, bit: 2 },
  R: { row: 2, bit: 3 },
  T: { row: 2, bit: 4 },
  "1": { row: 3, bit: 0 },
  "2": { row: 3, bit: 1 },
  "3": { row: 3, bit: 2 },
  "4": { row: 3, bit: 3 },
  "5": { row: 3, bit: 4 },
  "0": { row: 4, bit: 0 },
  "9": { row: 4, bit: 1 },
  "8": { row: 4, bit: 2 },
  "7": { row: 4, bit: 3 },
  "6": { row: 4, bit: 4 },
  P: { row: 5, bit: 0 },
  O: { row: 5, bit: 1 },
  I: { row: 5, bit: 2 },
  U: { row: 5, bit: 3 },
  Y: { row: 5, bit: 4 },
  ENTER: { row: 6, bit: 0 },
  L: { row: 6, bit: 1 },
  K: { row: 6, bit: 2 },
  J: { row: 6, bit: 3 },
  H: { row: 6, bit: 4 },
  SPACE: { row: 7, bit: 0 },
  M: { row: 7, bit: 2 },
  N: { row: 7, bit: 3 },
  B: { row: 7, bit: 4 },
};

/** PC punctuation character -> the Spectrum key whose red SYMBOL SHIFT legend
 * prints it, e.g. typing `"` means SYMBOL_SHIFT + P. BASIC keywords with no
 * single-character legend (STOP, AND, OR, AT, TO, THEN, STEP, NOT) aren't
 * included — there's no PC-key equivalent for those. `^` maps to the
 * power-operator key (H, printed with an up-arrow) as the closest modern analogue. */
export const SYMBOL_SHIFT_CHARS: Record<string, MatrixKey> = {
  "!": { row: 3, bit: 0 }, // 1
  "@": { row: 3, bit: 1 }, // 2
  "#": { row: 3, bit: 2 }, // 3
  $: { row: 3, bit: 3 }, // 4
  "%": { row: 3, bit: 4 }, // 5
  "&": { row: 4, bit: 4 }, // 6
  "'": { row: 4, bit: 3 }, // 7
  "(": { row: 4, bit: 2 }, // 8
  ")": { row: 4, bit: 1 }, // 9
  _: { row: 4, bit: 0 }, // 0
  "<": { row: 2, bit: 3 }, // R
  ">": { row: 2, bit: 4 }, // T
  ";": { row: 5, bit: 1 }, // O
  '"': { row: 5, bit: 0 }, // P
  "^": { row: 6, bit: 4 }, // H
  "-": { row: 6, bit: 3 }, // J
  "+": { row: 6, bit: 2 }, // K
  "=": { row: 6, bit: 1 }, // L
  ".": { row: 7, bit: 2 }, // M
  ",": { row: 7, bit: 3 }, // N
  "*": { row: 7, bit: 4 }, // B
  "?": { row: 0, bit: 3 }, // C
  "/": { row: 0, bit: 4 }, // V
  "£": { row: 0, bit: 2 }, // X
  ":": { row: 0, bit: 1 }, // Z
};
