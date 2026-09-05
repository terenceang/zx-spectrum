import { Flag, SZ53_TABLE, SZ53P_TABLE } from "../flags.js";
import { RegIndex } from "../registers.js";
import type { Z80 } from "../z80.js";

function overflowAdd8(a: number, b: number, result8: number): boolean {
  return (~(a ^ b) & (a ^ result8) & 0x80) !== 0;
}
function overflowSub8(a: number, b: number, result8: number): boolean {
  return ((a ^ b) & (a ^ result8) & 0x80) !== 0;
}

export function add8(cpu: Z80, value: number, carry = 0): void {
  const a = cpu.regs.bytes[RegIndex.A]!;
  const result = a + value + carry;
  const result8 = result & 0xff;
  let f = 0;
  if ((a & 0xf) + (value & 0xf) + carry > 0xf) f |= Flag.H;
  if (result > 0xff) f |= Flag.C;
  if (overflowAdd8(a, value, result8)) f |= Flag.PV;
  f |= SZ53_TABLE[result8]!;
  cpu.regs.bytes[RegIndex.A] = result8;
  cpu.f = f;
}

export function sub8(cpu: Z80, value: number, carry = 0): void {
  const a = cpu.regs.bytes[RegIndex.A]!;
  const result = a - value - carry;
  const result8 = result & 0xff;
  let f = Flag.N;
  if ((a & 0xf) - (value & 0xf) - carry < 0) f |= Flag.H;
  if (result < 0) f |= Flag.C;
  if (overflowSub8(a, value, result8)) f |= Flag.PV;
  f |= SZ53_TABLE[result8]!;
  cpu.regs.bytes[RegIndex.A] = result8;
  cpu.f = f;
}

export function cp8(cpu: Z80, value: number): void {
  const a = cpu.regs.bytes[RegIndex.A]!;
  const result = a - value;
  const result8 = result & 0xff;
  let f = Flag.N;
  if ((a & 0xf) - (value & 0xf) < 0) f |= Flag.H;
  if (result < 0) f |= Flag.C;
  if (overflowSub8(a, value, result8)) f |= Flag.PV;
  f |= SZ53_TABLE[result8]! & (Flag.S | Flag.Z);
  f |= value & (Flag.F5 | Flag.F3);
  cpu.f = f;
}

export function and8(cpu: Z80, value: number): void {
  const result = cpu.regs.bytes[RegIndex.A]! & value;
  cpu.regs.bytes[RegIndex.A] = result;
  cpu.f = SZ53P_TABLE[result]! | Flag.H;
}

export function or8(cpu: Z80, value: number): void {
  const result = cpu.regs.bytes[RegIndex.A]! | value;
  cpu.regs.bytes[RegIndex.A] = result;
  cpu.f = SZ53P_TABLE[result]!;
}

export function xor8(cpu: Z80, value: number): void {
  const result = cpu.regs.bytes[RegIndex.A]! ^ value;
  cpu.regs.bytes[RegIndex.A] = result;
  cpu.f = SZ53P_TABLE[result]!;
}

export function inc8(cpu: Z80, value: number): number {
  const result = (value + 1) & 0xff;
  let f = cpu.f & Flag.C;
  if ((value & 0xf) === 0xf) f |= Flag.H;
  if (value === 0x7f) f |= Flag.PV;
  f |= SZ53_TABLE[result]!;
  cpu.f = f;
  return result;
}

export function dec8(cpu: Z80, value: number): number {
  const result = (value - 1) & 0xff;
  let f = (cpu.f & Flag.C) | Flag.N;
  if ((value & 0xf) === 0x0) f |= Flag.H;
  if (value === 0x80) f |= Flag.PV;
  f |= SZ53_TABLE[result]!;
  cpu.f = f;
  return result;
}

export function add16(cpu: Z80, a: number, b: number): number {
  const result = a + b;
  const result16 = result & 0xffff;
  let f = cpu.f & (Flag.S | Flag.Z | Flag.PV);
  if ((a & 0xfff) + (b & 0xfff) > 0xfff) f |= Flag.H;
  if (result > 0xffff) f |= Flag.C;
  f |= (result16 >> 8) & (Flag.F5 | Flag.F3);
  cpu.f = f;
  cpu.regs.memptr = (a + 1) & 0xffff;
  return result16;
}

export function adc16(cpu: Z80, a: number, b: number): number {
  const carry = cpu.getFlag(Flag.C) ? 1 : 0;
  const result = a + b + carry;
  const result16 = result & 0xffff;
  let f = 0;
  if ((a & 0xfff) + (b & 0xfff) + carry > 0xfff) f |= Flag.H;
  if (result > 0xffff) f |= Flag.C;
  if ((~(a ^ b) & (a ^ result16) & 0x8000) !== 0) f |= Flag.PV;
  if (result16 & 0x8000) f |= Flag.S;
  if (result16 === 0) f |= Flag.Z;
  f |= (result16 >> 8) & (Flag.F5 | Flag.F3);
  cpu.f = f;
  cpu.regs.memptr = (a + 1) & 0xffff;
  return result16;
}

export function sbc16(cpu: Z80, a: number, b: number): number {
  const carry = cpu.getFlag(Flag.C) ? 1 : 0;
  const result = a - b - carry;
  const result16 = result & 0xffff;
  let f = Flag.N;
  if ((a & 0xfff) - (b & 0xfff) - carry < 0) f |= Flag.H;
  if (result < 0) f |= Flag.C;
  if (((a ^ b) & (a ^ result16) & 0x8000) !== 0) f |= Flag.PV;
  if (result16 & 0x8000) f |= Flag.S;
  if (result16 === 0) f |= Flag.Z;
  f |= (result16 >> 8) & (Flag.F5 | Flag.F3);
  cpu.f = f;
  cpu.regs.memptr = (a + 1) & 0xffff;
  return result16;
}

export function daa(cpu: Z80): void {
  const a = cpu.regs.bytes[RegIndex.A]!;
  const cFlag = cpu.getFlag(Flag.C);
  const hFlag = cpu.getFlag(Flag.H);
  const nFlag = cpu.getFlag(Flag.N);

  let correction = 0;
  let carry = cFlag;
  if (hFlag || (a & 0xf) > 9) correction |= 0x06;
  if (cFlag || a > 0x99) {
    correction |= 0x60;
    carry = true;
  }

  const result = (nFlag ? a - correction : a + correction) & 0xff;
  const halfCarry = nFlag ? hFlag && (a & 0xf) < 6 : (a & 0xf) > 9;

  let f = SZ53P_TABLE[result]!;
  if (nFlag) f |= Flag.N;
  if (carry) f |= Flag.C;
  if (halfCarry) f |= Flag.H;
  cpu.f = f;
  cpu.regs.bytes[RegIndex.A] = result;
}

export function cpl(cpu: Z80): void {
  const result = ~cpu.regs.bytes[RegIndex.A]! & 0xff;
  cpu.regs.bytes[RegIndex.A] = result;
  let f = cpu.f & (Flag.S | Flag.Z | Flag.PV | Flag.C);
  f |= Flag.H | Flag.N;
  f |= result & (Flag.F5 | Flag.F3);
  cpu.f = f;
}

export function neg(cpu: Z80): void {
  const a = cpu.regs.bytes[RegIndex.A]!;
  const result = (0 - a) & 0xff;
  let f = Flag.N;
  if ((a & 0xf) !== 0) f |= Flag.H;
  if (a !== 0) f |= Flag.C;
  if (a === 0x80) f |= Flag.PV;
  f |= SZ53_TABLE[result]!;
  cpu.regs.bytes[RegIndex.A] = result;
  cpu.f = f;
}

export function ccf(cpu: Z80): void {
  const oldC = cpu.getFlag(Flag.C);
  let f = cpu.f & (Flag.S | Flag.Z | Flag.PV);
  f |= oldC ? Flag.H : 0;
  f |= oldC ? 0 : Flag.C;
  f |= cpu.regs.bytes[RegIndex.A]! & (Flag.F5 | Flag.F3);
  cpu.f = f;
}

export function scf(cpu: Z80): void {
  let f = cpu.f & (Flag.S | Flag.Z | Flag.PV);
  f |= Flag.C;
  f |= cpu.regs.bytes[RegIndex.A]! & (Flag.F5 | Flag.F3);
  cpu.f = f;
}

export function rlca(cpu: Z80): void {
  const a = cpu.regs.bytes[RegIndex.A]!;
  const carry = (a & 0x80) !== 0;
  const result = ((a << 1) | (carry ? 1 : 0)) & 0xff;
  cpu.regs.bytes[RegIndex.A] = result;
  let f = cpu.f & (Flag.S | Flag.Z | Flag.PV);
  f |= carry ? Flag.C : 0;
  f |= result & (Flag.F5 | Flag.F3);
  cpu.f = f;
}

export function rrca(cpu: Z80): void {
  const a = cpu.regs.bytes[RegIndex.A]!;
  const carry = (a & 0x01) !== 0;
  const result = ((a >> 1) | (carry ? 0x80 : 0)) & 0xff;
  cpu.regs.bytes[RegIndex.A] = result;
  let f = cpu.f & (Flag.S | Flag.Z | Flag.PV);
  f |= carry ? Flag.C : 0;
  f |= result & (Flag.F5 | Flag.F3);
  cpu.f = f;
}

export function rla(cpu: Z80): void {
  const a = cpu.regs.bytes[RegIndex.A]!;
  const oldCarry = cpu.getFlag(Flag.C) ? 1 : 0;
  const newCarry = (a & 0x80) !== 0;
  const result = ((a << 1) | oldCarry) & 0xff;
  cpu.regs.bytes[RegIndex.A] = result;
  let f = cpu.f & (Flag.S | Flag.Z | Flag.PV);
  f |= newCarry ? Flag.C : 0;
  f |= result & (Flag.F5 | Flag.F3);
  cpu.f = f;
}

export function rra(cpu: Z80): void {
  const a = cpu.regs.bytes[RegIndex.A]!;
  const oldCarry = cpu.getFlag(Flag.C) ? 1 : 0;
  const newCarry = (a & 0x01) !== 0;
  const result = ((a >> 1) | (oldCarry ? 0x80 : 0)) & 0xff;
  cpu.regs.bytes[RegIndex.A] = result;
  let f = cpu.f & (Flag.S | Flag.Z | Flag.PV);
  f |= newCarry ? Flag.C : 0;
  f |= result & (Flag.F5 | Flag.F3);
  cpu.f = f;
}

export function rlc8(cpu: Z80, value: number): number {
  const carry = (value & 0x80) !== 0;
  const result = ((value << 1) | (carry ? 1 : 0)) & 0xff;
  cpu.f = SZ53P_TABLE[result]! | (carry ? Flag.C : 0);
  return result;
}

export function rrc8(cpu: Z80, value: number): number {
  const carry = (value & 0x01) !== 0;
  const result = ((value >> 1) | (carry ? 0x80 : 0)) & 0xff;
  cpu.f = SZ53P_TABLE[result]! | (carry ? Flag.C : 0);
  return result;
}

export function rl8(cpu: Z80, value: number): number {
  const oldCarry = cpu.getFlag(Flag.C) ? 1 : 0;
  const carry = (value & 0x80) !== 0;
  const result = ((value << 1) | oldCarry) & 0xff;
  cpu.f = SZ53P_TABLE[result]! | (carry ? Flag.C : 0);
  return result;
}

export function rr8(cpu: Z80, value: number): number {
  const oldCarry = cpu.getFlag(Flag.C) ? 1 : 0;
  const carry = (value & 0x01) !== 0;
  const result = ((value >> 1) | (oldCarry ? 0x80 : 0)) & 0xff;
  cpu.f = SZ53P_TABLE[result]! | (carry ? Flag.C : 0);
  return result;
}

export function sla8(cpu: Z80, value: number): number {
  const carry = (value & 0x80) !== 0;
  const result = (value << 1) & 0xff;
  cpu.f = SZ53P_TABLE[result]! | (carry ? Flag.C : 0);
  return result;
}

export function sra8(cpu: Z80, value: number): number {
  const carry = (value & 0x01) !== 0;
  const result = ((value >> 1) | (value & 0x80)) & 0xff;
  cpu.f = SZ53P_TABLE[result]! | (carry ? Flag.C : 0);
  return result;
}

export function sll8(cpu: Z80, value: number): number {
  const carry = (value & 0x80) !== 0;
  const result = ((value << 1) | 0x01) & 0xff;
  cpu.f = SZ53P_TABLE[result]! | (carry ? Flag.C : 0);
  return result;
}

export function srl8(cpu: Z80, value: number): number {
  const carry = (value & 0x01) !== 0;
  const result = (value >> 1) & 0x7f;
  cpu.f = SZ53P_TABLE[result]! | (carry ? Flag.C : 0);
  return result;
}

export function bit8(cpu: Z80, bitIndex: number, value: number): void {
  const bitSet = (value & (1 << bitIndex)) !== 0;
  let f = Flag.H | (cpu.f & Flag.C);
  if (!bitSet) f |= Flag.Z | Flag.PV;
  if (bitIndex === 7 && bitSet) f |= Flag.S;
  f |= value & (Flag.F5 | Flag.F3);
  cpu.f = f;
}

export function bitFromMemory(cpu: Z80, bitIndex: number, value: number): void {
  const bitSet = (value & (1 << bitIndex)) !== 0;
  let f = Flag.H | (cpu.f & Flag.C);
  if (!bitSet) f |= Flag.Z | Flag.PV;
  if (bitIndex === 7 && bitSet) f |= Flag.S;
  const memptrHigh = (cpu.regs.memptr >> 8) & 0xff;
  f |= memptrHigh & (Flag.F5 | Flag.F3);
  cpu.f = f;
}

export function res8(bitIndex: number, value: number): number {
  return value & ~(1 << bitIndex) & 0xff;
}

export function set8(bitIndex: number, value: number): number {
  return (value | (1 << bitIndex)) & 0xff;
}

export const ROTATE_OPS: readonly ((cpu: Z80, value: number) => number)[] = [
  rlc8,
  rrc8,
  rl8,
  rr8,
  sla8,
  sra8,
  sll8,
  srl8,
];
