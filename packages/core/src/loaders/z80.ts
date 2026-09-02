import type { CpuState } from "../cpu/z80.js";
import { REGISTERS_BYTE_LENGTH, RegIndex, WORDS_LENGTH, WordIndex } from "../cpu/registers.js";
import { RAM_48K_SIZE, ROM_PAGE_SIZE } from "../memory/constants.js";
import { decompressZ80Rle } from "./rle.js";

export type Z80HardwareMode = "48k" | "128k" | "other";

export interface ParsedZ80Snapshot {
  version: 1 | 2 | 3;
  hardwareMode: Z80HardwareMode;
  cpu: CpuState;
  border: number;
  /** v1: the single 48K RAM image (0x4000-0xFFFF), always present and already
   * decompressed. v2/v3: also present, reconstructed from the page blocks using the
   * *current* 128K paging state for convenience callers that only care about 48K
   * behavior — full bank-accurate reconstruction for Machine128k is `banks`. */
  ram: Uint8Array;
  /** v2/v3 only: every RAM page block as parsed, keyed by its raw page number (see
   * the .z80 spec's page-number table) — what Machine128k will need in Phase 3. */
  banks?: { pageNumber: number; data: Uint8Array }[];
  port7ffd?: number;
  ayRegisters?: Uint8Array;
}

export function parseZ80(bytes: Uint8Array): ParsedZ80Snapshot {
  const registerBytes = new Uint8Array(REGISTERS_BYTE_LENGTH);
  const registerWords = new Uint16Array(WORDS_LENGTH);

  registerBytes[RegIndex.A] = bytes[0]!;
  registerBytes[RegIndex.F] = bytes[1]!;
  registerBytes[RegIndex.C] = bytes[2]!;
  registerBytes[RegIndex.B] = bytes[3]!;
  registerBytes[RegIndex.L] = bytes[4]!;
  registerBytes[RegIndex.H] = bytes[5]!;
  const headerPc = bytes[6]! | (bytes[7]! << 8);
  registerWords[WordIndex.SP] = bytes[8]! | (bytes[9]! << 8);
  registerBytes[RegIndex.I] = bytes[10]!;
  let r = bytes[11]!;
  const flagsByte = bytes[12]!;
  if (flagsByte & 0x01) r |= 0x80;
  else r &= 0x7f;
  registerBytes[RegIndex.R] = r;
  const border = (flagsByte >> 1) & 0x07;
  const compressed48k = (flagsByte & 0x20) !== 0;
  registerBytes[RegIndex.E] = bytes[13]!;
  registerBytes[RegIndex.D] = bytes[14]!;
  registerBytes[RegIndex.C_] = bytes[15]!;
  registerBytes[RegIndex.B_] = bytes[16]!;
  registerBytes[RegIndex.E_] = bytes[17]!;
  registerBytes[RegIndex.D_] = bytes[18]!;
  registerBytes[RegIndex.L_] = bytes[19]!;
  registerBytes[RegIndex.H_] = bytes[20]!;
  registerBytes[RegIndex.A_] = bytes[21]!;
  registerBytes[RegIndex.F_] = bytes[22]!;
  const iy = bytes[23]! | (bytes[24]! << 8);
  const ix = bytes[25]! | (bytes[26]! << 8);
  registerWords[WordIndex.IY] = iy;
  registerWords[WordIndex.IX] = ix;
  registerBytes[RegIndex.IYL] = iy & 0xff;
  registerBytes[RegIndex.IYH] = iy >> 8;
  registerBytes[RegIndex.IXL] = ix & 0xff;
  registerBytes[RegIndex.IXH] = ix >> 8;
  const iff1 = bytes[27]! !== 0;
  const iff2 = bytes[28]! !== 0;
  const im = (bytes[29]! & 0x03) as 0 | 1 | 2;

  if (headerPc !== 0) {
    // Version 1: fixed 30-byte header, PC in the header, RAM follows (optionally
    // RLE-compressed with the 00 ED ED 00 sentinel).
    registerWords[WordIndex.PC] = headerPc;
    const body = bytes.subarray(30);
    const ram = compressed48k
      ? decompressZ80Rle(body, true)
      : body.subarray(0, RAM_48K_SIZE);

    return {
      version: 1,
      hardwareMode: "48k",
      cpu: { registerBytes, registerWords, iff1, iff2, im, halted: false },
      border,
      ram: padTo(ram, RAM_48K_SIZE),
    };
  }

  // Version 2/3: an extra header block follows byte 30, whose length selects the
  // version, then PC lives in that block instead of the fixed header.
  const additionalLength = bytes[30]! | (bytes[31]! << 8);
  const version: 2 | 3 = additionalLength === 23 ? 2 : 3;
  registerWords[WordIndex.PC] = bytes[32]! | (bytes[33]! << 8);
  const hardwareModeByte = bytes[34]!;
  const port7ffd = bytes[35]!;
  const ayRegisters = bytes.slice(39, 39 + 16);

  const hardwareMode: Z80HardwareMode =
    hardwareModeByte === 0 || hardwareModeByte === 1
      ? "48k"
      : hardwareModeByte === 3 || hardwareModeByte === 4
        ? "128k"
        : hardwareModeByte === 2
          ? "48k" // SamRam: treat as 48K-shaped for now, unsupported hardware
          : "other";

  const pageBlocksStart = 32 + additionalLength;
  const banks: { pageNumber: number; data: Uint8Array }[] = [];
  let offset = pageBlocksStart;
  while (offset + 3 <= bytes.length) {
    const blockLength = bytes[offset]! | (bytes[offset + 1]! << 8);
    const pageNumber = bytes[offset + 2]!;
    offset += 3;
    if (blockLength === 0xffff) {
      banks.push({ pageNumber, data: bytes.slice(offset, offset + ROM_PAGE_SIZE) });
      offset += ROM_PAGE_SIZE;
    } else {
      const compressed = bytes.subarray(offset, offset + blockLength);
      banks.push({ pageNumber, data: padTo(decompressZ80Rle(compressed, false), ROM_PAGE_SIZE) });
      offset += blockLength;
    }
  }

  const ram = new Uint8Array(RAM_48K_SIZE);
  if (hardwareMode === "48k") {
    for (const { pageNumber, data } of banks) {
      if (pageNumber === 8) ram.set(data, 0x0000); // 0x4000-0x7FFF
      else if (pageNumber === 4) ram.set(data, 0x4000); // 0x8000-0xBFFF
      else if (pageNumber === 5) ram.set(data, 0x8000); // 0xC000-0xFFFF
    }
  } else {
    // 128K: reconstruct the view for whichever bank the header's paging register
    // has in each fixed/paged slot (bank 5 always at 0x4000, bank 2 always at
    // 0x8000, the paged bank at 0xC000) — full multi-bank state lives in `banks`
    // for Machine128k (Phase 3) to use directly.
    const pagedBank = port7ffd & 0x07;
    for (const { pageNumber, data } of banks) {
      const bankNumber = pageNumber - 3;
      if (bankNumber === 5) ram.set(data, 0x0000);
      else if (bankNumber === 2) ram.set(data, 0x4000);
      else if (bankNumber === pagedBank) ram.set(data, 0x8000);
    }
  }

  return {
    version,
    hardwareMode,
    cpu: { registerBytes, registerWords, iff1, iff2, im, halted: false },
    border,
    ram,
    banks,
    port7ffd,
    ayRegisters,
  };
}

function padTo(data: Uint8Array, length: number): Uint8Array {
  if (data.length === length) return data;
  const out = new Uint8Array(length);
  out.set(data.subarray(0, length));
  return out;
}
