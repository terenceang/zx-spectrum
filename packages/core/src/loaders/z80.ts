import type { CpuState } from "../cpu/z80.js";
import { REGISTERS_BYTE_LENGTH, RegIndex, WORDS_LENGTH, WordIndex } from "../cpu/registers.js";
import type { BaseMachine } from "../machines/baseMachine.js";
import type { Machine128k } from "../machines/machine128k.js";
import type { Machine48k } from "../machines/machine48k.js";
import type { MachinePlus3 } from "../machines/machinePlus3.js";
import { RAM_48K_SIZE, ROM_PAGE_SIZE } from "../memory/constants.js";
import { compressZ80Rle, decompressZ80Rle } from "./rle.js";

export type Z80HardwareMode = "48k" | "128k" | "plus3" | "other";

export interface ParsedZ80Snapshot {
  version: 1 | 2 | 3;
  hardwareMode: Z80HardwareMode;
  cpu: CpuState;
  border: number;
  ram: Uint8Array;
  banks?: { pageNumber: number; data: Uint8Array }[];
  port7ffd?: number;
  port1ffd?: number | undefined;
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
    registerWords[WordIndex.PC] = headerPc;
    const body = bytes.subarray(30);
    const ram = compressed48k ? decompressZ80Rle(body, true) : body.subarray(0, RAM_48K_SIZE);

    return {
      version: 1,
      hardwareMode: "48k",
      cpu: { registerBytes, registerWords, iff1, iff2, im, halted: false },
      border,
      ram: padTo(ram, RAM_48K_SIZE),
    };
  }

  const additionalLength = bytes[30]! | (bytes[31]! << 8);
  const version: 2 | 3 = additionalLength === 23 ? 2 : 3;
  registerWords[WordIndex.PC] = bytes[32]! | (bytes[33]! << 8);
  const hardwareModeByte = bytes[34]!;
  const port7ffd = bytes[35]!;
  const ayRegisters = bytes.slice(39, 39 + 16);
  let port1ffd: number | undefined;
  if (additionalLength >= 55 && bytes.length > 86) {
    port1ffd = bytes[86]!;
  }

  const hardwareMode: Z80HardwareMode =
    hardwareModeByte === 0 || hardwareModeByte === 1
      ? "48k"
      : hardwareModeByte === 3 || hardwareModeByte === 4
        ? "128k"
        : hardwareModeByte === 7 || hardwareModeByte === 8
          ? "plus3"
          : hardwareModeByte === 2
            ? "48k"
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
      if (pageNumber === 8) ram.set(data, 0x0000);
      else if (pageNumber === 4) ram.set(data, 0x4000);
      else if (pageNumber === 5) ram.set(data, 0x8000);
    }
  } else {
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
    port1ffd,
    ayRegisters,
  };
}

function padTo(data: Uint8Array, length: number): Uint8Array {
  if (data.length === length) return data;
  const out = new Uint8Array(length);
  out.set(data.subarray(0, length));
  return out;
}

function writePageBlock(pageNumber: number, data: Uint8Array): Uint8Array {
  const compressed = compressZ80Rle(data);
  let len = compressed.length;
  let payload = compressed;
  if (len >= ROM_PAGE_SIZE) {
    len = 0xffff;
    payload = data;
  }
  const block = new Uint8Array(3 + payload.length);
  block[0] = len & 0xff;
  block[1] = (len >> 8) & 0xff;
  block[2] = pageNumber;
  block.set(payload, 3);
  return block;
}

function writeBaseHeader(cpu: CpuState, border: number): Uint8Array {
  const h = new Uint8Array(30);
  const bytes = cpu.registerBytes;
  const words = cpu.registerWords;

  h[0] = bytes[RegIndex.A]!;
  h[1] = bytes[RegIndex.F]!;
  h[2] = bytes[RegIndex.C]!;
  h[3] = bytes[RegIndex.B]!;
  h[4] = bytes[RegIndex.L]!;
  h[5] = bytes[RegIndex.H]!;
  h[6] = 0;
  h[7] = 0;
  const sp = words[WordIndex.SP]!;
  h[8] = sp & 0xff;
  h[9] = (sp >> 8) & 0xff;
  h[10] = bytes[RegIndex.I]!;
  const r = bytes[RegIndex.R]!;
  h[11] = r & 0x7f;
  h[12] = ((r & 0x80) >> 7) | ((border & 0x07) << 1);
  h[13] = bytes[RegIndex.E]!;
  h[14] = bytes[RegIndex.D]!;
  h[15] = bytes[RegIndex.C_]!;
  h[16] = bytes[RegIndex.B_]!;
  h[17] = bytes[RegIndex.E_]!;
  h[18] = bytes[RegIndex.D_]!;
  h[19] = bytes[RegIndex.L_]!;
  h[20] = bytes[RegIndex.H_]!;
  h[21] = bytes[RegIndex.A_]!;
  h[22] = bytes[RegIndex.F_]!;
  const iy = words[WordIndex.IY]!;
  h[23] = iy & 0xff;
  h[24] = (iy >> 8) & 0xff;
  const ix = words[WordIndex.IX]!;
  h[25] = ix & 0xff;
  h[26] = (ix >> 8) & 0xff;
  h[27] = cpu.iff1 ? 1 : 0;
  h[28] = cpu.iff2 ? 1 : 0;
  h[29] = cpu.im & 0x03;
  return h;
}

function writeExtHeader(
  pc: number,
  hardwareModeByte: number,
  port7ffd = 0,
  port1ffd = 0,
  aySelectedReg = 0,
  ayRegisters?: Uint8Array,
): Uint8Array {
  const ext = new Uint8Array(2 + 55);
  ext[0] = 55;
  ext[1] = 0;
  ext[2] = pc & 0xff;
  ext[3] = (pc >> 8) & 0xff;
  ext[4] = hardwareModeByte;
  ext[5] = port7ffd;
  ext[6] = 0;
  ext[7] = 0;
  ext[8] = aySelectedReg & 0x0f;
  if (ayRegisters) {
    for (let i = 0; i < 16; i++) {
      ext[9 + i] = ayRegisters[i] ?? 0;
    }
  }
  ext[2 + 54] = port1ffd;
  return ext;
}

function assembleZ80File(
  cpu: CpuState,
  border: number,
  hardwareModeByte: number,
  port7ffd: number,
  port1ffd: number,
  aySelectedReg: number,
  ayRegisters: Uint8Array | undefined,
  pageBlocks: Uint8Array[],
): Uint8Array {
  const baseHeader = writeBaseHeader(cpu, border);
  const pc = cpu.registerWords[WordIndex.PC]!;
  const extHeader = writeExtHeader(
    pc,
    hardwareModeByte,
    port7ffd,
    port1ffd,
    aySelectedReg,
    ayRegisters,
  );
  const totalLength =
    baseHeader.length + extHeader.length + pageBlocks.reduce((acc, p) => acc + p.length, 0);

  const out = new Uint8Array(totalLength);
  out.set(baseHeader, 0);
  out.set(extHeader, baseHeader.length);
  let offset = baseHeader.length + extHeader.length;
  for (const p of pageBlocks) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function writeZ8048k(machine: Machine48k, border: number): Uint8Array {
  const cpu = machine.cpu.getState();
  const ram = machine.memory.readRam();
  const page8 = writePageBlock(8, ram.subarray(0, ROM_PAGE_SIZE));
  const page4 = writePageBlock(4, ram.subarray(ROM_PAGE_SIZE, ROM_PAGE_SIZE * 2));
  const page5 = writePageBlock(5, ram.subarray(ROM_PAGE_SIZE * 2, ROM_PAGE_SIZE * 3));
  return assembleZ80File(cpu, border, 0, 0, 0, 0, undefined, [page8, page4, page5]);
}

function writeZ80Banked(
  machine: Machine128k | MachinePlus3,
  border: number,
  hardwareModeByte: number,
  port1ffd = 0,
): Uint8Array {
  const cpu = machine.cpu.getState();
  const port7ffd = machine.memory.port7ffd;
  const aySelected = machine.ay.selectedRegisterIndex;
  const ayRegs = machine.ay.getRegisters();

  const pages: Uint8Array[] = [];
  for (let bank = 0; bank < 8; bank++) {
    pages.push(writePageBlock(bank + 3, machine.memory.peekBank(bank)));
  }
  return assembleZ80File(
    cpu,
    border,
    hardwareModeByte,
    port7ffd,
    port1ffd,
    aySelected,
    ayRegs,
    pages,
  );
}

export function writeZ80128k(machine: Machine128k, border: number): Uint8Array {
  return writeZ80Banked(machine, border, 4, 0);
}

export function writeZ80Plus3(machine: MachinePlus3, border: number): Uint8Array {
  return writeZ80Banked(machine, border, 7, machine.memory.port1ffd);
}

export function writeZ80(machine: BaseMachine, border: number): Uint8Array {
  if ("fdc" in machine) {
    return writeZ80Plus3(machine as MachinePlus3, border);
  }
  if ("ay" in machine) {
    return writeZ80128k(machine as Machine128k, border);
  }
  return writeZ8048k(machine as Machine48k, border);
}
