import { RegIndex } from "../registers.js";
import type { IndexRegister, OpcodeFn, OpcodeTable } from "../types.js";
import type { Z80 } from "../z80.js";
import { add16, dec8, inc8 } from "./alu.js";
import { ALU_OPS, buildBaseTable } from "./baseTable.js";
import { getIndexedAddress, getReg8Plain, setReg8Plain } from "./registerAccess.js";

// DD/FD-prefixed (non-CB) opcode map. Real Z80 hardware behavior: the prefix only
// changes anything for the ~60 opcodes that reference HL, H, or L; every other
// opcode behaves exactly like its unprefixed counterpart (just 4T slower for the
// wasted prefix fetch, which the dispatcher already accounts for). So this table
// starts as a copy of the base table's function references and only overrides the
// affected slots — see docs/architecture.md for the full enumerated list this
// mirrors (Sean Young's "The Undocumented Z80 Documented").

export function buildIndexTable(reg: IndexRegister): OpcodeTable {
  const table: OpcodeFn[] = buildBaseTable().slice();

  const HIGH = reg === "ix" ? RegIndex.IXH : RegIndex.IYH;
  const LOW = reg === "ix" ? RegIndex.IXL : RegIndex.IYL;

  const getIndexReg = (cpu: Z80): number => (reg === "ix" ? cpu.regs.ix : cpu.regs.iy);
  const setIndexReg = (cpu: Z80, value: number): void => {
    if (reg === "ix") cpu.regs.ix = value & 0xffff;
    else cpu.regs.iy = value & 0xffff;
  };
  const getHigh = (cpu: Z80): number => cpu.regs.bytes[HIGH]!;
  const setHigh = (cpu: Z80, value: number): void => {
    cpu.regs.bytes[HIGH] = value & 0xff;
    if (reg === "ix") cpu.regs.syncIx();
    else cpu.regs.syncIy();
  };
  const getLow = (cpu: Z80): number => cpu.regs.bytes[LOW]!;
  const setLow = (cpu: Z80, value: number): void => {
    cpu.regs.bytes[LOW] = value & 0xff;
    if (reg === "ix") cpu.regs.syncIx();
    else cpu.regs.syncIy();
  };
  const getSubReg = (cpu: Z80, code: number): number => {
    if (code === 4) return getHigh(cpu);
    if (code === 5) return getLow(cpu);
    return getReg8Plain(cpu, code);
  };
  const setSubReg = (cpu: Z80, code: number, value: number): void => {
    if (code === 4) setHigh(cpu, value);
    else if (code === 5) setLow(cpu, value);
    else setReg8Plain(cpu, code, value);
  };

  // ---- ADD index,rr / LD index,nn / LD (nn),index / LD index,(nn) / INC/DEC index ----
  table[0x09] = (cpu) => {
    cpu.contend(cpu.regs.pc, 7);
    setIndexReg(cpu, add16(cpu, getIndexReg(cpu), cpu.regs.bc));
  };
  table[0x19] = (cpu) => {
    cpu.contend(cpu.regs.pc, 7);
    setIndexReg(cpu, add16(cpu, getIndexReg(cpu), cpu.regs.de));
  };
  table[0x29] = (cpu) => {
    cpu.contend(cpu.regs.pc, 7);
    const v = getIndexReg(cpu);
    setIndexReg(cpu, add16(cpu, v, v));
  };
  table[0x39] = (cpu) => {
    cpu.contend(cpu.regs.pc, 7);
    setIndexReg(cpu, add16(cpu, getIndexReg(cpu), cpu.regs.sp));
  };

  table[0x21] = (cpu) => setIndexReg(cpu, cpu.fetchOperandWord());
  table[0x22] = (cpu) => {
    const addr = cpu.fetchOperandWord();
    cpu.writeWord(addr, getIndexReg(cpu));
    cpu.regs.memptr = (addr + 1) & 0xffff;
  };
  table[0x2a] = (cpu) => {
    const addr = cpu.fetchOperandWord();
    setIndexReg(cpu, cpu.readWord(addr));
    cpu.regs.memptr = (addr + 1) & 0xffff;
  };
  table[0x23] = (cpu) => {
    cpu.contend(cpu.regs.pc, 2);
    setIndexReg(cpu, (getIndexReg(cpu) + 1) & 0xffff);
  };
  table[0x2b] = (cpu) => {
    cpu.contend(cpu.regs.pc, 2);
    setIndexReg(cpu, (getIndexReg(cpu) - 1) & 0xffff);
  };

  // ---- undocumented INC/DEC/LD n on IXH/IXL ----
  table[0x24] = (cpu) => setHigh(cpu, inc8(cpu, getHigh(cpu)));
  table[0x25] = (cpu) => setHigh(cpu, dec8(cpu, getHigh(cpu)));
  table[0x26] = (cpu) => setHigh(cpu, cpu.fetchOperandByte());
  table[0x2c] = (cpu) => setLow(cpu, inc8(cpu, getLow(cpu)));
  table[0x2d] = (cpu) => setLow(cpu, dec8(cpu, getLow(cpu)));
  table[0x2e] = (cpu) => setLow(cpu, cpu.fetchOperandByte());

  // ---- INC/DEC/LD (index+d) ----
  table[0x34] = (cpu) => {
    const addr = getIndexedAddress(cpu, getIndexReg(cpu));
    const value = cpu.readByte(addr);
    cpu.contend(addr, 1);
    cpu.writeByte(addr, inc8(cpu, value));
  };
  table[0x35] = (cpu) => {
    const addr = getIndexedAddress(cpu, getIndexReg(cpu));
    const value = cpu.readByte(addr);
    cpu.contend(addr, 1);
    cpu.writeByte(addr, dec8(cpu, value));
  };
  table[0x36] = (cpu) => {
    // LD (index+d),n: unlike the other (index+d) opcodes, the internal delay here
    // is only 2T and comes after *both* operand bytes (d then n), not right after d.
    const d = cpu.fetchDisplacement();
    const n = cpu.fetchOperandByte();
    cpu.contend(cpu.regs.pc, 2);
    const addr = (getIndexReg(cpu) + d) & 0xffff;
    cpu.regs.memptr = addr;
    cpu.writeByte(addr, n);
  };

  // ---- LD r,(index+d) / LD (index+d),r: the *other* operand stays literal B/C/D/E/H/L/A ----
  for (const dest of [0, 1, 2, 3, 4, 5, 7]) {
    const opcode = 0x40 + dest * 8 + 6;
    table[opcode] = (cpu) => {
      const addr = getIndexedAddress(cpu, getIndexReg(cpu));
      setReg8Plain(cpu, dest, cpu.readByte(addr));
    };
  }
  for (const src of [0, 1, 2, 3, 4, 5, 7]) {
    const opcode = 0x70 + src;
    table[opcode] = (cpu) => {
      const addr = getIndexedAddress(cpu, getIndexReg(cpu));
      cpu.writeByte(addr, getReg8Plain(cpu, src));
    };
  }

  // ---- LD r,r' where either side is H or L: undocumented IXH/IXL substitution ----
  for (const dest of [0, 1, 2, 3, 4, 5, 7]) {
    for (const src of [0, 1, 2, 3, 4, 5, 7]) {
      if (dest !== 4 && dest !== 5 && src !== 4 && src !== 5) continue;
      const opcode = 0x40 + dest * 8 + src;
      table[opcode] = (cpu) => setSubReg(cpu, dest, getSubReg(cpu, src));
    }
  }

  // ---- ALU A,r for r=H/L/(HL) ----
  for (let op = 0; op < 8; op++) {
    table[0x80 + op * 8 + 4] = (cpu) => ALU_OPS[op]!(cpu, getHigh(cpu));
    table[0x80 + op * 8 + 5] = (cpu) => ALU_OPS[op]!(cpu, getLow(cpu));
    table[0x80 + op * 8 + 6] = (cpu) => {
      const addr = getIndexedAddress(cpu, getIndexReg(cpu));
      ALU_OPS[op]!(cpu, cpu.readByte(addr));
    };
  }

  // ---- POP/PUSH/EX (SP)/JP/LD SP,index ----
  table[0xe1] = (cpu) => setIndexReg(cpu, cpu.pop());
  table[0xe5] = (cpu) => {
    cpu.contend(cpu.regs.pc, 1);
    cpu.push(getIndexReg(cpu));
  };
  table[0xe3] = (cpu) => {
    const sp = cpu.regs.sp;
    const low = cpu.readByte(sp);
    const high = cpu.readByte((sp + 1) & 0xffff);
    cpu.contend((sp + 1) & 0xffff, 1);
    const oldIndex = getIndexReg(cpu);
    cpu.writeByte((sp + 1) & 0xffff, (oldIndex >> 8) & 0xff);
    cpu.writeByte(sp, oldIndex & 0xff);
    cpu.contend(sp, 2);
    setIndexReg(cpu, (high << 8) | low);
    cpu.regs.memptr = getIndexReg(cpu);
  };
  table[0xe9] = (cpu) => {
    cpu.regs.pc = getIndexReg(cpu);
  };
  table[0xf9] = (cpu) => {
    cpu.contend(cpu.regs.pc, 2);
    cpu.regs.sp = getIndexReg(cpu);
  };

  return table;
}
