import type { CpuState } from "../cpu/z80.js";
import { REGISTERS_BYTE_LENGTH, RegIndex, WORDS_LENGTH, WordIndex } from "../cpu/registers.js";
import type { MachineModel } from "../machines/types.js";
import { RAM_48K_SIZE, ROM_PAGE_SIZE } from "../memory/constants.js";

/** Parsed .sna snapshot, independent of any live Machine — apply() (in
 * loaders/apply.ts) is what actually pokes this into a running machine. Keeping
 * parse and apply separate makes both independently testable. */
export interface ParsedSnaSnapshot {
  model: MachineModel;
  cpu: CpuState;
  border: number;
  /** Flat 48K RAM image (0x4000-0xFFFF), 49152 bytes. */
  ram: Uint8Array;
  /** Present only for the 128K .sna variant: the other 5 RAM banks not already
   * covered by `ram` (which holds whatever banks 5/2/[paged] were active), plus
   * the paging register state needed to reconstruct the full 128K memory map. */
  pagedBanks?: { bank: number; data: Uint8Array }[];
  port7ffd?: number;
}

const HEADER_LENGTH = 27;
const SNA_48K_LENGTH = HEADER_LENGTH + RAM_48K_SIZE;

export function parseSna(bytes: Uint8Array): ParsedSnaSnapshot {
  if (bytes.length !== SNA_48K_LENGTH && bytes.length < SNA_48K_LENGTH + 4) {
    throw new Error(`Not a valid .sna file: unexpected length ${bytes.length}`);
  }

  const registerBytes = new Uint8Array(REGISTERS_BYTE_LENGTH);
  const registerWords = new Uint16Array(WORDS_LENGTH);

  registerBytes[RegIndex.I] = bytes[0]!;
  registerBytes[RegIndex.L_] = bytes[1]!;
  registerBytes[RegIndex.H_] = bytes[2]!;
  registerBytes[RegIndex.E_] = bytes[3]!;
  registerBytes[RegIndex.D_] = bytes[4]!;
  registerBytes[RegIndex.C_] = bytes[5]!;
  registerBytes[RegIndex.B_] = bytes[6]!;
  registerBytes[RegIndex.F_] = bytes[7]!;
  registerBytes[RegIndex.A_] = bytes[8]!;
  registerBytes[RegIndex.L] = bytes[9]!;
  registerBytes[RegIndex.H] = bytes[10]!;
  registerBytes[RegIndex.E] = bytes[11]!;
  registerBytes[RegIndex.D] = bytes[12]!;
  registerBytes[RegIndex.C] = bytes[13]!;
  registerBytes[RegIndex.B] = bytes[14]!;
  const iyLow = bytes[15]!;
  const iyHigh = bytes[16]!;
  const ixLow = bytes[17]!;
  const ixHigh = bytes[18]!;
  registerBytes[RegIndex.IYL] = iyLow;
  registerBytes[RegIndex.IYH] = iyHigh;
  registerBytes[RegIndex.IXL] = ixLow;
  registerBytes[RegIndex.IXH] = ixHigh;
  registerWords[WordIndex.IY] = (iyHigh << 8) | iyLow;
  registerWords[WordIndex.IX] = (ixHigh << 8) | ixLow;

  const iff2Byte = bytes[19]!;
  const iff2 = (iff2Byte & 0x04) !== 0;
  registerBytes[RegIndex.R] = bytes[20]!;
  registerBytes[RegIndex.F] = bytes[21]!;
  registerBytes[RegIndex.A] = bytes[22]!;
  const sp = bytes[23]! | (bytes[24]! << 8);
  registerWords[WordIndex.SP] = sp;
  const im = (bytes[25]! & 0x03) as 0 | 1 | 2;
  const border = bytes[26]! & 0x07;

  const ram = bytes.slice(HEADER_LENGTH, HEADER_LENGTH + RAM_48K_SIZE);

  // The 48K .sna format has no PC field: it's stored on top of the stack by the
  // tool that created the snapshot, so loading it means "popping" PC from (SP) and
  // adjusting SP by 2 — exactly what a RET would do.
  const spOffset = (sp - ROM_PAGE_SIZE) & 0xffff;
  let pc: number;
  if (bytes.length === SNA_48K_LENGTH) {
    if (sp < ROM_PAGE_SIZE || sp > 0xffff) {
      throw new Error(`Invalid SP in .sna snapshot: 0x${sp.toString(16)} (must be in RAM range 0x4000-0xFFFF)`);
    }
    const low = ram[spOffset]!;
    const high = ram[(spOffset + 1) & 0xffff]!;
    pc = (high << 8) | low;
    registerWords[WordIndex.SP] = (sp + 2) & 0xffff;

    return {
      model: "48k",
      cpu: {
        registerBytes,
        registerWords: setPc(registerWords, pc),
        iff1: iff2,
        iff2,
        im,
        halted: false,
      },
      border,
      ram,
    };
  }

  // 128K .sna: extends the 48K format with an explicit PC field and additional
  // paged-out RAM banks.
  pc = bytes[SNA_48K_LENGTH]! | (bytes[SNA_48K_LENGTH + 1]! << 8);
  const port7ffd = bytes[SNA_48K_LENGTH + 2]!;
  // byte SNA_48K_LENGTH+3 is a TR-DOS paging flag we don't model.
  const pagedBanks: { bank: number; data: Uint8Array }[] = [];
  let offset = SNA_48K_LENGTH + 4;
  const activeBank = port7ffd & 0x07;
  for (let bank = 0; bank < 8; bank++) {
    if (bank === 5 || bank === 2 || bank === activeBank) continue; // already in `ram`
    if (offset + ROM_PAGE_SIZE > bytes.length) break;
    pagedBanks.push({ bank, data: bytes.slice(offset, offset + ROM_PAGE_SIZE) });
    offset += ROM_PAGE_SIZE;
  }

  return {
    model: "128k",
    cpu: {
      registerBytes,
      registerWords: setPc(registerWords, pc),
      iff1: iff2,
      iff2,
      im,
      halted: false,
    },
    border,
    ram,
    pagedBanks,
    port7ffd,
  };
}

function setPc(words: Uint16Array, pc: number): Uint16Array {
  words[WordIndex.PC] = pc;
  return words;
}
