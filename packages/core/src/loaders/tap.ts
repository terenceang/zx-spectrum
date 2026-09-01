import {
  BIT0_PULSE,
  BIT1_PULSE,
  DATA_PILOT_COUNT,
  DEFAULT_PAUSE_TSTATES,
  HEADER_PILOT_COUNT,
  PILOT_PULSE,
  SYNC1_PULSE,
  SYNC2_PULSE,
  appendPilotSyncData,
  type TapePulseSequence,
} from "./tapePulse.js";

/** .tap: a flat sequence of length-prefixed blocks (2-byte LE length + flag byte +
 * data + checksum), each played back as a standard-speed ROM loader block. */
export function parseTap(bytes: Uint8Array): TapePulseSequence {
  const pulses: TapePulseSequence = [];
  let level: 0 | 1 = 1;
  let offset = 0;

  while (offset + 2 <= bytes.length) {
    const blockLength = bytes[offset]! | (bytes[offset + 1]! << 8);
    offset += 2;
    if (offset + blockLength > bytes.length) break;
    const block = bytes.subarray(offset, offset + blockLength);
    offset += blockLength;

    const flag = block[0] ?? 0;
    level = appendPilotSyncData(pulses, block, level, {
      pilotPulse: PILOT_PULSE,
      pilotCount: flag < 128 ? HEADER_PILOT_COUNT : DATA_PILOT_COUNT,
      sync1: SYNC1_PULSE,
      sync2: SYNC2_PULSE,
      bit0: BIT0_PULSE,
      bit1: BIT1_PULSE,
      usedBitsInLastByte: 8,
    });
    pulses.push({ level: 0, duration: DEFAULT_PAUSE_TSTATES });
    // The next block's pilot tone must start with a real edge out of the pause
    // (matching the file's own initial level=1) — leaving level at 0 here would
    // push the next pilot pulse at the same level as the pause, merging them into
    // one flat segment and silently dropping the pilot tone's first transition.
    level = 1;
  }

  return pulses;
}
