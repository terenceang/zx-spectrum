/** One edge-to-edge interval of the tape signal. `.tap` and `.tzx` both parse down
 * to this one representation (a `.tap` block is treated as the equivalent of a TZX
 * "standard speed data" block), so a single TapeEdgePlayer (tapePlayer.ts) drives
 * playback for either format. */
export interface TapePulse {
  level: 0 | 1;
  duration: number; // T-states
}
export type TapePulseSequence = TapePulse[];

// Standard ROM loader timings (T-states at 3.5MHz), used by .tap blocks and by
// TZX's "standard speed data" block (ID 0x10).
export const PILOT_PULSE = 2168;
export const SYNC1_PULSE = 667;
export const SYNC2_PULSE = 735;
export const BIT0_PULSE = 855;
export const BIT1_PULSE = 1710;
export const HEADER_PILOT_COUNT = 8063;
export const DATA_PILOT_COUNT = 3223;
/** ~1s gap after a block, matching the pause most .tap-producing tools assume. */
export const DEFAULT_PAUSE_TSTATES = 3_500_000;

/** Appends one block's pilot+sync+data pulses (the shape every ROM-loader-style
 * block shares, standard or turbo) to `pulses`, continuing the alternating level
 * from whatever it already is. Returns the level after the block, before any
 * pause (callers append their own pause pulse at level 0). */
export function appendPilotSyncData(
  pulses: TapePulse[],
  data: Uint8Array,
  startLevel: 0 | 1,
  opts: {
    pilotPulse: number;
    pilotCount: number;
    sync1: number;
    sync2: number;
    bit0: number;
    bit1: number;
    usedBitsInLastByte: number;
  },
): 0 | 1 {
  let level = startLevel;
  const flip = (): 0 | 1 => (level = level ? 0 : 1);

  for (let i = 0; i < opts.pilotCount; i++) {
    pulses.push({ level, duration: opts.pilotPulse });
    flip();
  }
  if (opts.sync1 > 0) {
    pulses.push({ level, duration: opts.sync1 });
    flip();
  }
  if (opts.sync2 > 0) {
    pulses.push({ level, duration: opts.sync2 });
    flip();
  }

  for (let byteIndex = 0; byteIndex < data.length; byteIndex++) {
    const byte = data[byteIndex]!;
    const bitsInByte = byteIndex === data.length - 1 ? opts.usedBitsInLastByte : 8;
    for (let bit = 7; bit >= 8 - bitsInByte; bit--) {
      const duration = (byte >> bit) & 1 ? opts.bit1 : opts.bit0;
      pulses.push({ level, duration });
      flip();
      pulses.push({ level, duration });
      flip();
    }
  }

  return level;
}
