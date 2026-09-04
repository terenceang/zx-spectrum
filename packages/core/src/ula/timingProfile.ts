/** Per-model timing constants driving contention, interrupt, and frame-rasterization
 * timing. 48K/128K/+3 differ almost entirely in these numbers rather than in logic,
 * so one UlaEngine (see ulaEngine.ts) is parameterized by a profile instead of the
 * three models each getting a duplicated ULA class. */
export interface UlaTimingProfile {
  tStatesPerLine: number;
  linesPerFrame: number;
  /** T-state (within the frame) of the first contended screen-fetch cycle. */
  firstContendedTstate: number;
  /** Number of consecutive display lines during which the per-line 128 T-state
   * contention window applies. */
  contendedLines: number;
  /** How many T-states the ULA holds the maskable interrupt line low for, once per
   * frame, starting at T-state 0. */
  interruptLength: number;
  /** Border lines above/below the 192-line display area, and border columns either
   * side of the 256-pixel display width, used to size the rendered framebuffer. */
  borderTopLines: number;
  borderBottomLines: number;
  borderSideColumns: number; // in 8-pixel character cells
}

/** The classic contention delay shape repeating every 8 T-states through each
 * contended line's 128 T-state screen-fetch window. */
export const CONTENTION_PATTERN = [6, 5, 4, 3, 2, 1, 0, 0] as const;

export const ULA_48K_PROFILE: UlaTimingProfile = {
  tStatesPerLine: 224,
  linesPerFrame: 312,
  firstContendedTstate: 14335,
  contendedLines: 192,
  interruptLength: 32,
  borderTopLines: 48,
  borderBottomLines: 56,
  borderSideColumns: 4,
};

/** Same border geometry as the 48K (192 display lines, 48/56 border lines) — the
 * 128K's extra scanline vs. the 48K's 312 lands in vertical retrace, not the
 * visible border, so it doesn't change the rendered frame size. */
export const ULA_128K_PROFILE: UlaTimingProfile = {
  tStatesPerLine: 228,
  linesPerFrame: 311,
  firstContendedTstate: 14361,
  contendedLines: 192,
  interruptLength: 36,
  borderTopLines: 48,
  borderBottomLines: 56,
  borderSideColumns: 4,
};

/** The +3 timing profile is identical in scanlines/geometry to the 128K, with an
 * interrupt duration of 32 T-states. */
export const ULA_PLUS3_PROFILE: UlaTimingProfile = {
  tStatesPerLine: 228,
  linesPerFrame: 311,
  firstContendedTstate: 14361,
  contendedLines: 192,
  interruptLength: 32,
  borderTopLines: 48,
  borderBottomLines: 56,
  borderSideColumns: 4,
};

export function tStatesPerFrame(profile: UlaTimingProfile): number {
  return profile.tStatesPerLine * profile.linesPerFrame;
}
