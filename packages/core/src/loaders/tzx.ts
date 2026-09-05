import {
  TSTATES_PER_MS,
  appendPilotSyncData,
  appendStandardRomBlock,
  appendTapePause,
  type TapeBlock,
  type TapePulseSequence,
} from "./tapePulse.js";

export function parseTzx(bytes: Uint8Array): TapePulseSequence {
  if (bytes.length < 10 || String.fromCharCode(...bytes.subarray(0, 7)) !== "ZXTape!") {
    throw new Error("Not a valid .tzx file: missing 'ZXTape!' signature");
  }

  const pulses: TapePulseSequence = [];
  const blocks: TapeBlock[] = [];
  Object.defineProperty(pulses, "blocks", {
    value: blocks,
    writable: true,
    enumerable: false,
    configurable: true,
  });
  let level: 0 | 1 = 1;
  let offset = 10;

  const u16 = (o: number): number => bytes[o]! | (bytes[o + 1]! << 8);
  const u24 = (o: number): number => bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16);

  while (offset < bytes.length) {
    const blockId = bytes[offset]!;
    offset += 1;

    switch (blockId) {
      case 0x10: {
        if (offset + 4 > bytes.length) throw new Error("Truncated 0x10 block in .tzx");
        const pauseMs = u16(offset);
        const length = u16(offset + 2);
        const data = bytes.subarray(offset + 4, offset + 4 + length);
        offset += 4 + length;
        const pulseStartIndex = pulses.length;
        level = appendStandardRomBlock(pulses, data, level);
        level = appendTapePause(pulses, pauseMs * TSTATES_PER_MS);
        const pulseEndIndex = pulses.length;
        blocks.push({
          data,
          pulseStartIndex,
          pulseEndIndex,
        });
        break;
      }
      case 0x11: {
        if (offset + 18 > bytes.length) throw new Error("Truncated 0x11 block in .tzx");
        const pilotPulse = u16(offset);
        const sync1 = u16(offset + 2);
        const sync2 = u16(offset + 4);
        const bit0 = u16(offset + 6);
        const bit1 = u16(offset + 8);
        const pilotCount = u16(offset + 10);
        const usedBitsInLastByte = bytes[offset + 12]!;
        const pauseMs = u16(offset + 13);
        const length = u24(offset + 15);
        const data = bytes.subarray(offset + 18, offset + 18 + length);
        offset += 18 + length;
        const pulseStartIndex = pulses.length;
        level = appendPilotSyncData(pulses, data, level, {
          pilotPulse,
          pilotCount,
          sync1,
          sync2,
          bit0,
          bit1,
          usedBitsInLastByte,
        });
        level = appendTapePause(pulses, pauseMs * TSTATES_PER_MS);
        const pulseEndIndex = pulses.length;
        blocks.push({
          data,
          pulseStartIndex,
          pulseEndIndex,
        });
        break;
      }
      case 0x12: {
        if (offset + 4 > bytes.length) throw new Error("Truncated 0x12 block in .tzx");
        const pulseLength = u16(offset);
        const count = u16(offset + 2);
        offset += 4;
        for (let i = 0; i < count; i++) {
          pulses.push({ level, duration: pulseLength });
          level = level ? 0 : 1;
        }
        break;
      }
      case 0x13: {
        if (offset + 1 > bytes.length) throw new Error("Truncated 0x13 block in .tzx");
        const count = bytes[offset]!;
        offset += 1;
        for (let i = 0; i < count; i++) {
          pulses.push({ level, duration: u16(offset) });
          level = level ? 0 : 1;
          offset += 2;
        }
        break;
      }
      case 0x14: {
        if (offset + 10 > bytes.length) throw new Error("Truncated 0x14 block in .tzx");
        const bit0 = u16(offset);
        const bit1 = u16(offset + 2);
        const usedBitsInLastByte = bytes[offset + 4]!;
        const pauseMs = u16(offset + 5);
        const length = u24(offset + 7);
        const data = bytes.subarray(offset + 10, offset + 10 + length);
        offset += 10 + length;
        level = appendPilotSyncData(pulses, data, level, {
          pilotPulse: 0,
          pilotCount: 0,
          sync1: 0,
          sync2: 0,
          bit0,
          bit1,
          usedBitsInLastByte,
        });
        level = appendTapePause(pulses, pauseMs * TSTATES_PER_MS);
        break;
      }
      case 0x20: {
        if (offset + 2 > bytes.length) throw new Error("Truncated 0x20 block in .tzx");
        const pauseMs = u16(offset);
        offset += 2;
        level = appendTapePause(pulses, pauseMs * TSTATES_PER_MS);
        break;
      }
      case 0x21: {
        if (offset + 1 > bytes.length) throw new Error("Truncated 0x21 block in .tzx");
        const length = bytes[offset]!;
        offset += 1 + length;
        break;
      }
      case 0x22: {
        break;
      }
      case 0x30: {
        if (offset + 1 > bytes.length) throw new Error("Truncated 0x30 block in .tzx");
        const length = bytes[offset]!;
        offset += 1 + length;
        break;
      }
      case 0x32: {
        if (offset + 2 > bytes.length) throw new Error("Truncated 0x32 block in .tzx");
        const length = u16(offset);
        offset += 2 + length;
        break;
      }
      case 0x33: {
        if (offset + 1 > bytes.length) throw new Error("Truncated 0x33 block in .tzx");
        const count = bytes[offset]!;
        offset += 1 + count * 3;
        break;
      }
      default:
        throw new Error(
          `Unsupported .tzx block ID 0x${blockId.toString(16)} at offset ${offset - 1} — ` +
            `only the common speed-data/pause/metadata blocks are implemented`,
        );
    }
  }

  return pulses;
}
