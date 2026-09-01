import {
  BIT0_PULSE,
  BIT1_PULSE,
  DATA_PILOT_COUNT,
  HEADER_PILOT_COUNT,
  PILOT_PULSE,
  SYNC1_PULSE,
  SYNC2_PULSE,
  appendPilotSyncData,
  type TapePulseSequence,
} from "./tapePulse.js";

const TSTATES_PER_MS = 3500;

// Block IDs covering real-world .tzx content: the speed-data variants (which is
// what any pulse ends up as) plus the common metadata/grouping blocks, which are
// skipped for playback but still need their length parsed correctly so later
// blocks stay aligned. Rarer blocks (generalized data, C64-rom-style extensions,
// etc.) aren't handled — see the thrown error below if one is hit.
export function parseTzx(bytes: Uint8Array): TapePulseSequence {
  if (
    bytes.length < 10 ||
    String.fromCharCode(...bytes.subarray(0, 7)) !== "ZXTape!"
  ) {
    throw new Error("Not a valid .tzx file: missing 'ZXTape!' signature");
  }

  const pulses: TapePulseSequence = [];
  let level: 0 | 1 = 1;
  let offset = 10; // 7-byte signature + 0x1A + 2-byte version

  const u16 = (o: number): number => bytes[o]! | (bytes[o + 1]! << 8);
  const u24 = (o: number): number => bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16);

  while (offset < bytes.length) {
    const blockId = bytes[offset]!;
    offset += 1;

    switch (blockId) {
      case 0x10: {
        // Standard Speed Data Block: pause(ms), length, data
        const pauseMs = u16(offset);
        const length = u16(offset + 2);
        const data = bytes.subarray(offset + 4, offset + 4 + length);
        offset += 4 + length;
        const flag = data[0] ?? 0;
        level = appendPilotSyncData(pulses, data, level, {
          pilotPulse: PILOT_PULSE,
          pilotCount: flag < 128 ? HEADER_PILOT_COUNT : DATA_PILOT_COUNT,
          sync1: SYNC1_PULSE,
          sync2: SYNC2_PULSE,
          bit0: BIT0_PULSE,
          bit1: BIT1_PULSE,
          usedBitsInLastByte: 8,
        });
        if (pauseMs > 0) {
          pulses.push({ level: 0, duration: pauseMs * TSTATES_PER_MS });
          level = 0;
        }
        break;
      }
      case 0x11: {
        // Turbo Speed Data Block: fully custom timings.
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
        level = appendPilotSyncData(pulses, data, level, {
          pilotPulse,
          pilotCount,
          sync1,
          sync2,
          bit0,
          bit1,
          usedBitsInLastByte,
        });
        if (pauseMs > 0) {
          pulses.push({ level: 0, duration: pauseMs * TSTATES_PER_MS });
          level = 0;
        }
        break;
      }
      case 0x12: {
        // Pure Tone: one pulse length repeated N times.
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
        // Pulse sequence: explicit list of pulse lengths.
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
        // Pure Data Block: bit timings only, no pilot/sync.
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
        if (pauseMs > 0) {
          pulses.push({ level: 0, duration: pauseMs * TSTATES_PER_MS });
          level = 0;
        }
        break;
      }
      case 0x20: {
        // Pause/stop-the-tape: 0ms conventionally means "stop and wait for the
        // user" — we don't model a stop-gate in Phase 2, so it's just a no-op.
        const pauseMs = u16(offset);
        offset += 2;
        if (pauseMs > 0) {
          pulses.push({ level: 0, duration: pauseMs * TSTATES_PER_MS });
          level = 0;
        }
        break;
      }
      case 0x21: {
        // Group start: 1-byte length + text, no timing effect.
        const length = bytes[offset]!;
        offset += 1 + length;
        break;
      }
      case 0x22: {
        // Group end: no payload.
        break;
      }
      case 0x30: {
        // Text description: 1-byte length + text.
        const length = bytes[offset]!;
        offset += 1 + length;
        break;
      }
      case 0x32: {
        // Archive info: 2-byte length + content.
        const length = u16(offset);
        offset += 2 + length;
        break;
      }
      case 0x33: {
        // Hardware type: 1-byte count of 3-byte entries.
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
