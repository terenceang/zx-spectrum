import { RegIndex } from "../registers.js";
import type { Z80 } from "../z80.js";

// The 3-bit "r" field used throughout the base opcode map: 0=B 1=C 2=D 3=E 4=H 5=L
// 6=(HL) 7=A. These are the *unprefixed* accessors — always literal B/C/D/E/H/L/A,
// never substituted for IXH/IXL. The DD/FD-prefixed table has its own explicit
// handlers for the ~60 opcodes the prefix actually affects (see indexTable.ts);
// everywhere else it simply reuses these base-table functions unchanged, which is
// exactly correct real-hardware behavior (the prefix "does nothing" for opcodes that
// don't touch H, L, or (HL), beyond wasting 4 T-states on the prefix fetch).

const PLAIN_REG_MAP = [
  RegIndex.B,
  RegIndex.C,
  RegIndex.D,
  RegIndex.E,
  RegIndex.H,
  RegIndex.L,
  -1, // (HL) — handled specially below
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

/** Computes the effective (index+d) address for a DD/FD-prefixed instruction that
 * addresses memory: fetches the displacement byte, applies the documented 5 extra
 * T-states of internal delay before the actual memory access, and sets MEMPTR. */
export function getIndexedAddress(cpu: Z80, indexValue: number): number {
  const d = cpu.fetchDisplacement();
  cpu.contend(cpu.regs.pc, 5);
  const addr = (indexValue + d) & 0xffff;
  cpu.regs.memptr = addr;
  return addr;
}
