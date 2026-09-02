import {
  DEFAULT_PAUSE_TSTATES,
  appendStandardRomBlock,
  appendTapePause,
  type TapeBlock,
  type TapePulseSequence,
} from "./tapePulse.js";

/** .tap: a flat sequence of length-prefixed blocks (2-byte LE length + flag byte +
 * data + checksum), each played back as a standard-speed ROM loader block. */
export function parseTap(bytes: Uint8Array): TapePulseSequence {
  const pulses: TapePulseSequence = [];
  const blocks: TapeBlock[] = [];
  Object.defineProperty(pulses, "blocks", { value: blocks, writable: true, enumerable: false, configurable: true });
  let level: 0 | 1 = 1;
  let offset = 0;

  while (offset + 2 <= bytes.length) {
    const blockLength = bytes[offset]! | (bytes[offset + 1]! << 8);
    offset += 2;
    if (offset + blockLength > bytes.length) break;
    const block = bytes.subarray(offset, offset + blockLength);
    offset += blockLength;

    const pulseStartIndex = pulses.length;
    level = appendStandardRomBlock(pulses, block, level);
    level = appendTapePause(pulses, DEFAULT_PAUSE_TSTATES);
    const pulseEndIndex = pulses.length;

    blocks.push({
      data: block,
      pulseStartIndex,
      pulseEndIndex,
    });
  }

  return pulses;
}
