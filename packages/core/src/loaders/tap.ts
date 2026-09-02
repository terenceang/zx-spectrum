import {
  DEFAULT_PAUSE_TSTATES,
  appendStandardRomBlock,
  appendTapePause,
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

    level = appendStandardRomBlock(pulses, block, level);
    level = appendTapePause(pulses, DEFAULT_PAUSE_TSTATES);
  }

  return pulses;
}
