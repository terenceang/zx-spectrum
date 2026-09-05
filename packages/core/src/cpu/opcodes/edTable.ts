import { Flag, SZ53_TABLE, SZ53P_TABLE, parityOf } from "../flags.js";
import { RegIndex } from "../registers.js";
import type { OpcodeFn, OpcodeTable } from "../types.js";
import type { Z80 } from "../z80.js";
import { adc16, neg, sbc16 } from "./alu.js";
import { getReg8Plain, setReg8Plain } from "./registerAccess.js";

function getPair16(cpu: Z80, code: number): number {
  switch (code) {
    case 0:
      return cpu.regs.bc;
    case 1:
      return cpu.regs.de;
    case 2:
      return cpu.regs.hl;
    default:
      return cpu.regs.sp;
  }
}
function setPair16(cpu: Z80, code: number, value: number): void {
  switch (code) {
    case 0:
      cpu.regs.bc = value;
      break;
    case 1:
      cpu.regs.de = value;
      break;
    case 2:
      cpu.regs.hl = value;
      break;
    default:
      cpu.regs.sp = value;
      break;
  }
}

function retn(cpu: Z80): void {
  cpu.iff1 = cpu.iff2;
  const addr = cpu.pop();
  cpu.regs.pc = addr;
  cpu.regs.memptr = addr;
}

function ldi(cpu: Z80): void {
  const value = cpu.readByte(cpu.regs.hl);
  cpu.writeByte(cpu.regs.de, value);
  cpu.contend(cpu.regs.de, 2);
  cpu.regs.hl = (cpu.regs.hl + 1) & 0xffff;
  cpu.regs.de = (cpu.regs.de + 1) & 0xffff;
  cpu.regs.bc = (cpu.regs.bc - 1) & 0xffff;
  const n = (value + cpu.regs.bytes[RegIndex.A]!) & 0xff;
  let f = cpu.f & (Flag.S | Flag.Z | Flag.C);
  if (cpu.regs.bc !== 0) f |= Flag.PV;
  f |= n & Flag.F3;
  if (n & 0x02) f |= Flag.F5;
  cpu.f = f;
}
function ldd(cpu: Z80): void {
  const value = cpu.readByte(cpu.regs.hl);
  cpu.writeByte(cpu.regs.de, value);
  cpu.contend(cpu.regs.de, 2);
  cpu.regs.hl = (cpu.regs.hl - 1) & 0xffff;
  cpu.regs.de = (cpu.regs.de - 1) & 0xffff;
  cpu.regs.bc = (cpu.regs.bc - 1) & 0xffff;
  const n = (value + cpu.regs.bytes[RegIndex.A]!) & 0xff;
  let f = cpu.f & (Flag.S | Flag.Z | Flag.C);
  if (cpu.regs.bc !== 0) f |= Flag.PV;
  f |= n & Flag.F3;
  if (n & 0x02) f |= Flag.F5;
  cpu.f = f;
}
function ldir(cpu: Z80): void {
  ldi(cpu);
  if (cpu.regs.bc !== 0) {
    cpu.contend(cpu.regs.de, 5);
    cpu.regs.pc = (cpu.regs.pc - 2) & 0xffff;
    cpu.regs.memptr = (cpu.regs.pc + 1) & 0xffff;
  }
}
function lddr(cpu: Z80): void {
  ldd(cpu);
  if (cpu.regs.bc !== 0) {
    cpu.contend(cpu.regs.de, 5);
    cpu.regs.pc = (cpu.regs.pc - 2) & 0xffff;
    cpu.regs.memptr = (cpu.regs.pc + 1) & 0xffff;
  }
}

function cpi(cpu: Z80): void {
  const value = cpu.readByte(cpu.regs.hl);
  cpu.contend(cpu.regs.hl, 5);
  const a = cpu.regs.bytes[RegIndex.A]!;
  const result = (a - value) & 0xff;
  const halfCarry = (a & 0xf) < (value & 0xf) ? 1 : 0;
  cpu.regs.hl = (cpu.regs.hl + 1) & 0xffff;
  cpu.regs.bc = (cpu.regs.bc - 1) & 0xffff;
  cpu.regs.memptr = (cpu.regs.memptr + 1) & 0xffff;
  let f = Flag.N | (cpu.f & Flag.C);
  f |= SZ53_TABLE[result]! & (Flag.S | Flag.Z);
  if (halfCarry) f |= Flag.H;
  if (cpu.regs.bc !== 0) f |= Flag.PV;
  const n = (result - halfCarry) & 0xff;
  f |= n & Flag.F3;
  if (n & 0x02) f |= Flag.F5;
  cpu.f = f;
}
function cpd(cpu: Z80): void {
  const value = cpu.readByte(cpu.regs.hl);
  cpu.contend(cpu.regs.hl, 5);
  const a = cpu.regs.bytes[RegIndex.A]!;
  const result = (a - value) & 0xff;
  const halfCarry = (a & 0xf) < (value & 0xf) ? 1 : 0;
  cpu.regs.hl = (cpu.regs.hl - 1) & 0xffff;
  cpu.regs.bc = (cpu.regs.bc - 1) & 0xffff;
  cpu.regs.memptr = (cpu.regs.memptr - 1) & 0xffff;
  let f = Flag.N | (cpu.f & Flag.C);
  f |= SZ53_TABLE[result]! & (Flag.S | Flag.Z);
  if (halfCarry) f |= Flag.H;
  if (cpu.regs.bc !== 0) f |= Flag.PV;
  const n = (result - halfCarry) & 0xff;
  f |= n & Flag.F3;
  if (n & 0x02) f |= Flag.F5;
  cpu.f = f;
}
function cpir(cpu: Z80): void {
  cpi(cpu);
  if (cpu.regs.bc !== 0 && !cpu.getFlag(Flag.Z)) {
    cpu.contend(cpu.regs.hl, 5);
    cpu.regs.pc = (cpu.regs.pc - 2) & 0xffff;
  }
}
function cpdr(cpu: Z80): void {
  cpd(cpu);
  if (cpu.regs.bc !== 0 && !cpu.getFlag(Flag.Z)) {
    cpu.contend(cpu.regs.hl, 5);
    cpu.regs.pc = (cpu.regs.pc - 2) & 0xffff;
  }
}

function ini(cpu: Z80): void {
  cpu.contend(cpu.regs.pc, 1);
  const value = cpu.readPort(cpu.regs.bc);
  cpu.writeByte(cpu.regs.hl, value);
  const newB = (cpu.regs.bytes[RegIndex.B]! - 1) & 0xff;
  cpu.regs.bytes[RegIndex.B] = newB;
  cpu.regs.hl = (cpu.regs.hl + 1) & 0xffff;
  cpu.regs.memptr = (cpu.regs.bc + 1) & 0xffff;
  const c = cpu.regs.bytes[RegIndex.C]!;
  const hc = value + ((c + 1) & 0xff);
  let f = 0;
  if (value & 0x80) f |= Flag.N;
  if (hc > 0xff) f |= Flag.H | Flag.C;
  if (parityOf((hc & 7) ^ newB)) f |= Flag.PV;
  f |= SZ53_TABLE[newB]!;
  cpu.f = f;
}
function ind(cpu: Z80): void {
  cpu.contend(cpu.regs.pc, 1);
  const value = cpu.readPort(cpu.regs.bc);
  cpu.writeByte(cpu.regs.hl, value);
  const newB = (cpu.regs.bytes[RegIndex.B]! - 1) & 0xff;
  cpu.regs.bytes[RegIndex.B] = newB;
  cpu.regs.hl = (cpu.regs.hl - 1) & 0xffff;
  cpu.regs.memptr = (cpu.regs.bc - 1) & 0xffff;
  const c = cpu.regs.bytes[RegIndex.C]!;
  const hc = value + ((c - 1) & 0xff);
  let f = 0;
  if (value & 0x80) f |= Flag.N;
  if (hc > 0xff) f |= Flag.H | Flag.C;
  if (parityOf((hc & 7) ^ newB)) f |= Flag.PV;
  f |= SZ53_TABLE[newB]!;
  cpu.f = f;
}
function inir(cpu: Z80): void {
  ini(cpu);
  if (cpu.regs.bytes[RegIndex.B] !== 0) {
    cpu.contend(cpu.regs.hl, 5);
    cpu.regs.pc = (cpu.regs.pc - 2) & 0xffff;
  }
}
function indr(cpu: Z80): void {
  ind(cpu);
  if (cpu.regs.bytes[RegIndex.B] !== 0) {
    cpu.contend(cpu.regs.hl, 5);
    cpu.regs.pc = (cpu.regs.pc - 2) & 0xffff;
  }
}

function outi(cpu: Z80): void {
  const value = cpu.readByte(cpu.regs.hl);
  const newB = (cpu.regs.bytes[RegIndex.B]! - 1) & 0xff;
  cpu.regs.bytes[RegIndex.B] = newB;
  cpu.regs.hl = (cpu.regs.hl + 1) & 0xffff;
  cpu.contend(cpu.regs.hl, 1);
  const port = (newB << 8) | cpu.regs.bytes[RegIndex.C]!;
  cpu.writePort(port, value);
  cpu.regs.memptr = (port + 1) & 0xffff;
  const l = cpu.regs.bytes[RegIndex.L]!;
  const hc = value + l;
  let f = 0;
  if (value & 0x80) f |= Flag.N;
  if (hc > 0xff) f |= Flag.H | Flag.C;
  if (parityOf((hc & 7) ^ newB)) f |= Flag.PV;
  f |= SZ53_TABLE[newB]!;
  cpu.f = f;
}
function outd(cpu: Z80): void {
  const value = cpu.readByte(cpu.regs.hl);
  const newB = (cpu.regs.bytes[RegIndex.B]! - 1) & 0xff;
  cpu.regs.bytes[RegIndex.B] = newB;
  cpu.regs.hl = (cpu.regs.hl - 1) & 0xffff;
  cpu.contend(cpu.regs.hl, 1);
  const port = (newB << 8) | cpu.regs.bytes[RegIndex.C]!;
  cpu.writePort(port, value);
  cpu.regs.memptr = (port + 1) & 0xffff;
  const l = cpu.regs.bytes[RegIndex.L]!;
  const hc = value + l;
  let f = 0;
  if (value & 0x80) f |= Flag.N;
  if (hc > 0xff) f |= Flag.H | Flag.C;
  if (parityOf((hc & 7) ^ newB)) f |= Flag.PV;
  f |= SZ53_TABLE[newB]!;
  cpu.f = f;
}
function otir(cpu: Z80): void {
  outi(cpu);
  if (cpu.regs.bytes[RegIndex.B] !== 0) {
    cpu.contend(cpu.regs.bc, 5);
    cpu.regs.pc = (cpu.regs.pc - 2) & 0xffff;
  }
}
function otdr(cpu: Z80): void {
  outd(cpu);
  if (cpu.regs.bytes[RegIndex.B] !== 0) {
    cpu.contend(cpu.regs.bc, 5);
    cpu.regs.pc = (cpu.regs.pc - 2) & 0xffff;
  }
}

export function buildEdTable(): OpcodeTable {
  const table: OpcodeFn[] = new Array(256);

  for (let code = 0; code < 8; code++) {
    const inOpcode = 0x40 + code * 8;
    const outOpcode = 0x41 + code * 8;
    table[inOpcode] = (cpu) => {
      const port = cpu.regs.bc;
      const value = cpu.readPort(port);
      cpu.regs.memptr = (port + 1) & 0xffff;
      cpu.f = (SZ53P_TABLE[value]! as number) | (cpu.f & Flag.C);
      if (code !== 6) setReg8Plain(cpu, code, value);
    };
    table[outOpcode] = (cpu) => {
      const port = cpu.regs.bc;
      const value = code === 6 ? 0 : getReg8Plain(cpu, code);
      cpu.writePort(port, value);
      cpu.regs.memptr = (port + 1) & 0xffff;
    };
  }

  for (let p = 0; p < 4; p++) {
    table[0x42 + p * 0x10] = (cpu) => {
      cpu.contend(cpu.regs.pc, 7);
      cpu.regs.hl = sbc16(cpu, cpu.regs.hl, getPair16(cpu, p));
    };
    table[0x4a + p * 0x10] = (cpu) => {
      cpu.contend(cpu.regs.pc, 7);
      cpu.regs.hl = adc16(cpu, cpu.regs.hl, getPair16(cpu, p));
    };
    table[0x43 + p * 0x10] = (cpu) => {
      const addr = cpu.fetchOperandWord();
      cpu.writeWord(addr, getPair16(cpu, p));
      cpu.regs.memptr = (addr + 1) & 0xffff;
    };
    table[0x4b + p * 0x10] = (cpu) => {
      const addr = cpu.fetchOperandWord();
      setPair16(cpu, p, cpu.readWord(addr));
      cpu.regs.memptr = (addr + 1) & 0xffff;
    };
  }

  for (const opcode of [0x44, 0x4c, 0x54, 0x5c, 0x64, 0x6c, 0x74, 0x7c]) table[opcode] = neg;
  for (let p = 0; p < 4; p++) {
    table[0x45 + p * 0x10] = retn;
    table[0x4d + p * 0x10] = retn;
  }
  for (const opcode of [0x46, 0x4e, 0x66, 0x6e]) table[opcode] = (cpu) => (cpu.im = 0);
  for (const opcode of [0x56, 0x76]) table[opcode] = (cpu) => (cpu.im = 1);
  for (const opcode of [0x5e, 0x7e]) table[opcode] = (cpu) => (cpu.im = 2);

  table[0x47] = (cpu) => {
    cpu.contend(cpu.regs.pc, 1);
    cpu.regs.bytes[RegIndex.I] = cpu.regs.bytes[RegIndex.A]!;
  };
  table[0x4f] = (cpu) => {
    cpu.contend(cpu.regs.pc, 1);
    cpu.regs.bytes[RegIndex.R] = cpu.regs.bytes[RegIndex.A]!;
  };
  table[0x57] = (cpu) => {
    cpu.contend(cpu.regs.pc, 1);
    const i = cpu.regs.bytes[RegIndex.I]!;
    cpu.regs.bytes[RegIndex.A] = i;
    let f = cpu.f & Flag.C;
    f |= SZ53_TABLE[i]!;
    if (cpu.iff2) f |= Flag.PV;
    cpu.f = f;
  };
  table[0x5f] = (cpu) => {
    cpu.contend(cpu.regs.pc, 1);
    const r = cpu.regs.bytes[RegIndex.R]!;
    cpu.regs.bytes[RegIndex.A] = r;
    let f = cpu.f & Flag.C;
    f |= SZ53_TABLE[r]!;
    if (cpu.iff2) f |= Flag.PV;
    cpu.f = f;
  };

  table[0x67] = (cpu) => {
    const addr = cpu.regs.hl;
    const memVal = cpu.readByte(addr);
    cpu.contend(addr, 4);
    const a = cpu.regs.bytes[RegIndex.A]!;
    const newMem = ((a & 0x0f) << 4) | ((memVal >> 4) & 0x0f);
    const newA = (a & 0xf0) | (memVal & 0x0f);
    cpu.writeByte(addr, newMem);
    cpu.regs.bytes[RegIndex.A] = newA;
    cpu.f = SZ53P_TABLE[newA]! | (cpu.f & Flag.C);
    cpu.regs.memptr = (addr + 1) & 0xffff;
  };
  table[0x6f] = (cpu) => {
    const addr = cpu.regs.hl;
    const memVal = cpu.readByte(addr);
    cpu.contend(addr, 4);
    const a = cpu.regs.bytes[RegIndex.A]!;
    const newMem = ((memVal << 4) & 0xf0) | (a & 0x0f);
    const newA = (a & 0xf0) | ((memVal >> 4) & 0x0f);
    cpu.writeByte(addr, newMem);
    cpu.regs.bytes[RegIndex.A] = newA;
    cpu.f = SZ53P_TABLE[newA]! | (cpu.f & Flag.C);
    cpu.regs.memptr = (addr + 1) & 0xffff;
  };

  table[0xa0] = ldi;
  table[0xa8] = ldd;
  table[0xb0] = ldir;
  table[0xb8] = lddr;
  table[0xa1] = cpi;
  table[0xa9] = cpd;
  table[0xb1] = cpir;
  table[0xb9] = cpdr;
  table[0xa2] = ini;
  table[0xaa] = ind;
  table[0xb2] = inir;
  table[0xba] = indr;
  table[0xa3] = outi;
  table[0xab] = outd;
  table[0xb3] = otir;
  table[0xbb] = otdr;

  for (let i = 0; i < 256; i++) {
    if (!table[i]) table[i] = () => {};
  }

  return table;
}
