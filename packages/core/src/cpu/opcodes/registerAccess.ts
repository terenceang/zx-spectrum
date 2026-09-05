import { RegIndex } from "../registers.js";
import type { Z80 } from "../z80.js";

const PLAIN_REG_MAP = [
  RegIndex.B,
  RegIndex.C,
  RegIndex.D,
  RegIndex.E,
  RegIndex.H,
  RegIndex.L,
  -1,
  RegIndex.A,
] as const;

export function getReg8Plain(cpu: Z80, code: number): number {
  if (code === 6) return cpu.readByte(cpu.regs.hl);
  return cpu.regs.bytes[PLAIN_REG_MAP[code]!]!;
}

export function setReg8Plain(cpu: Z80, code: number, value: number): void {
  if (code === 6) {
    cpu.writeByte(cpu.regs.hl, value);
    return;
  }
  cpu.regs.bytes[PLAIN_REG_MAP[code]!] = value & 0xff;
}

export function getIndexedAddress(cpu: Z80, indexValue: number): number {
  const d = cpu.fetchDisplacement();
  cpu.contend(cpu.regs.pc, 5);
  const addr = (indexValue + d) & 0xffff;
  cpu.regs.memptr = addr;
  return addr;
}
