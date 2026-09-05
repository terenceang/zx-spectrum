import type { CpuState } from "../cpu/z80.js";
import { REGISTERS_BYTE_LENGTH, RegIndex, WORDS_LENGTH, WordIndex } from "../cpu/registers.js";
import type { BaseMachine } from "../machines/baseMachine.js";
import type { Machine128k } from "../machines/machine128k.js";
import type { Machine48k } from "../machines/machine48k.js";
import type { MachineModel } from "../machines/types.js";
import { RAM_48K_SIZE, ROM_PAGE_SIZE } from "../memory/constants.js";

export interface ParsedSnaSnapshot {
  model: MachineModel;
  cpu: CpuState;
  border: number;
  ram: Uint8Array;
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

  const spOffset = (sp - ROM_PAGE_SIZE) & 0xffff;
  let pc: number;
  if (bytes.length === SNA_48K_LENGTH) {
    if (sp < ROM_PAGE_SIZE || sp > 0xffff) {
      throw new Error(
        `Invalid SP in .sna snapshot: 0x${sp.toString(16)} (must be in RAM range 0x4000-0xFFFF)`,
      );
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

  pc = bytes[SNA_48K_LENGTH]! | (bytes[SNA_48K_LENGTH + 1]! << 8);
  const port7ffd = bytes[SNA_48K_LENGTH + 2]!;
  const pagedBanks: { bank: number; data: Uint8Array }[] = [];
  let offset = SNA_48K_LENGTH + 4;
  const activeBank = port7ffd & 0x07;
  for (let bank = 0; bank < 8; bank++) {
    if (bank === 5 || bank === 2 || bank === activeBank) continue;
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

function writeHeader(header: Uint8Array, cpu: CpuState, border: number): void {
  const bytes = cpu.registerBytes;
  header[0] = bytes[RegIndex.I]!;
  header[1] = bytes[RegIndex.L_]!;
  header[2] = bytes[RegIndex.H_]!;
  header[3] = bytes[RegIndex.E_]!;
  header[4] = bytes[RegIndex.D_]!;
  header[5] = bytes[RegIndex.C_]!;
  header[6] = bytes[RegIndex.B_]!;
  header[7] = bytes[RegIndex.F_]!;
  header[8] = bytes[RegIndex.A_]!;
  header[9] = bytes[RegIndex.L]!;
  header[10] = bytes[RegIndex.H]!;
  header[11] = bytes[RegIndex.E]!;
  header[12] = bytes[RegIndex.D]!;
  header[13] = bytes[RegIndex.C]!;
  header[14] = bytes[RegIndex.B]!;
  header[15] = bytes[RegIndex.IYL]!;
  header[16] = bytes[RegIndex.IYH]!;
  header[17] = bytes[RegIndex.IXL]!;
  header[18] = bytes[RegIndex.IXH]!;
  header[19] = cpu.iff2 ? 0x04 : 0x00;
  header[20] = bytes[RegIndex.R]!;
  header[21] = bytes[RegIndex.F]!;
  header[22] = bytes[RegIndex.A]!;
  header[25] = cpu.im & 0x03;
  header[26] = border & 0x07;
}

export function writeSna48k(machine: Machine48k, border: number): Uint8Array {
  const cpu = machine.cpu.getState();
  const header = new Uint8Array(HEADER_LENGTH);
  writeHeader(header, cpu, border);

  const ram = machine.memory.readRam().slice();
  const pc = cpu.registerWords[WordIndex.PC]!;
  const sp = (cpu.registerWords[WordIndex.SP]! - 2) & 0xffff;
  const spOffset = sp - ROM_PAGE_SIZE;
  if (spOffset < 0 || spOffset + 1 >= RAM_48K_SIZE) {
    throw new Error(`Cannot save .sna: SP 0x${sp.toString(16)} falls outside RAM after pushing PC`);
  }
  ram[spOffset] = pc & 0xff;
  ram[spOffset + 1] = (pc >> 8) & 0xff;
  header[23] = sp & 0xff;
  header[24] = (sp >> 8) & 0xff;

  const out = new Uint8Array(SNA_48K_LENGTH);
  out.set(header, 0);
  out.set(ram, HEADER_LENGTH);
  return out;
}

export function writeSna128k(machine: Machine128k, border: number): Uint8Array {
  const cpu = machine.cpu.getState();
  const header = new Uint8Array(HEADER_LENGTH);
  writeHeader(header, cpu, border);

  const sp = cpu.registerWords[WordIndex.SP]!;
  header[23] = sp & 0xff;
  header[24] = (sp >> 8) & 0xff;

  const port7ffd = machine.memory.port7ffd;
  const currentBank = port7ffd & 0x07;

  const ram = new Uint8Array(RAM_48K_SIZE);
  ram.set(machine.memory.peekBank(5), 0);
  ram.set(machine.memory.peekBank(2), ROM_PAGE_SIZE);
  ram.set(machine.memory.peekBank(currentBank), ROM_PAGE_SIZE * 2);

  const pagedBanks: number[] = [];
  for (let bank = 0; bank < 8; bank++) {
    if (bank === 5 || bank === 2 || bank === currentBank) continue;
    pagedBanks.push(bank);
  }

  const out = new Uint8Array(SNA_48K_LENGTH + 4 + pagedBanks.length * ROM_PAGE_SIZE);
  out.set(header, 0);
  out.set(ram, HEADER_LENGTH);
  const pc = cpu.registerWords[WordIndex.PC]!;
  out[SNA_48K_LENGTH] = pc & 0xff;
  out[SNA_48K_LENGTH + 1] = (pc >> 8) & 0xff;
  out[SNA_48K_LENGTH + 2] = port7ffd & 0xff;
  out[SNA_48K_LENGTH + 3] = 0;
  let offset = SNA_48K_LENGTH + 4;
  for (const bank of pagedBanks) {
    out.set(machine.memory.peekBank(bank), offset);
    offset += ROM_PAGE_SIZE;
  }
  return out;
}

export function isSnaSnapshot(bytes: Uint8Array): boolean {
  return (
    bytes.length === SNA_48K_LENGTH ||
    (bytes.length >= SNA_48K_LENGTH + 4 &&
      (bytes.length - (SNA_48K_LENGTH + 4)) % ROM_PAGE_SIZE === 0)
  );
}

export function writeSna(machine: BaseMachine, border: number): Uint8Array {
  if ("ay" in machine) {
    return writeSna128k(machine as Machine128k, border);
  }
  return writeSna48k(machine as Machine48k, border);
}
