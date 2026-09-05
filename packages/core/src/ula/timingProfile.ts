export interface UlaTimingProfile {
  tStatesPerLine: number;
  linesPerFrame: number;
  firstContendedTstate: number;
  contendedLines: number;
  interruptLength: number;
  borderTopLines: number;
  borderBottomLines: number;
  borderSideColumns: number;
}

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
