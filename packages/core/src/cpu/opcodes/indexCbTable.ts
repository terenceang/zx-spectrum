import type { IndexRegister, OpcodeFn, OpcodeTable } from "../types.js";
import type { Z80 } from "../z80.js";
import { bitFromMemory, res8, rl8, rlc8, rr8, rrc8, set8, sla8, sll8, sra8, srl8 } from "./alu.js";
import { setReg8Plain } from "./registerAccess.js";

// DD CB dd oo / FD CB dd oo: bit operations on (IX+d)/(IY+d). The dispatcher in
// z80.ts has already consumed the DD/FD prefix, the CB prefix, the displacement
// byte, and this opcode byte (14T total) before calling into this table — see the
// comment there for why none of those four bytes past the first are M1 cycles. Each
// handler here adds the remaining T-states for the (index+d) access itself.
//
// Undocumented "copy-back": for the rotate/shift and RES/SET forms (never BIT),
// when the low 3 bits of the opcode select a register other than (HL)'s slot (6),
// the result is written to *both* (index+d) and that plain register (B/C/D/E/H/L/A
// — never IXH/IXL). This is well-documented undocumented Z80 behavior.

const ROTATE_OPS: readonly ((cpu: Z80, value: number) => number)[] = [
  rlc8,
  rrc8,
  rl8,
  rr8,
  sla8,
  sra8,
  sll8,
  srl8,
];

export function buildIndexCbTable(reg: IndexRegister): OpcodeTable {
  const table: OpcodeFn[] = new Array(256);

  const indexValueOf = (cpu: Z80): number => (reg === "ix" ? cpu.regs.ix : cpu.regs.iy);

  const addressOf = (cpu: Z80): number => {
    const addr = (indexValueOf(cpu) + cpu.displacement) & 0xffff;
    cpu.regs.memptr = addr;
    return addr;
  };

  for (let op = 0; op < 8; op++) {
    for (let code = 0; code < 8; code++) {
      const opcode = op * 8 + code;
      table[opcode] = (cpu) => {
        const addr = addressOf(cpu);
        cpu.contend(addr, 3);
        const value = cpu.readByte(addr);
        const result = ROTATE_OPS[op]!(cpu, value);
        cpu.writeByte(addr, result);
        if (code !== 6) setReg8Plain(cpu, code, result);
      };
    }
  }

  for (let bit = 0; bit < 8; bit++) {
    for (let code = 0; code < 8; code++) {
      const opcode = 0x40 + bit * 8 + code;
      table[opcode] = (cpu) => {
        const addr = addressOf(cpu);
        cpu.contend(addr, 3);
        const value = cpu.readByte(addr);
        bitFromMemory(cpu, bit, value);
      };
    }
  }

  for (let bit = 0; bit < 8; bit++) {
    for (let code = 0; code < 8; code++) {
      const resOpcode = 0x80 + bit * 8 + code;
      const setOpcode = 0xc0 + bit * 8 + code;
      table[resOpcode] = (cpu) => {
        const addr = addressOf(cpu);
        cpu.contend(addr, 3);
        const value = cpu.readByte(addr);
        const result = res8(bit, value);
        cpu.writeByte(addr, result);
        if (code !== 6) setReg8Plain(cpu, code, result);
      };
      table[setOpcode] = (cpu) => {
        const addr = addressOf(cpu);
        cpu.contend(addr, 3);
        const value = cpu.readByte(addr);
        const result = set8(bit, value);
        cpu.writeByte(addr, result);
        if (code !== 6) setReg8Plain(cpu, code, result);
      };
    }
  }

  for (let i = 0; i < 256; i++) {
    if (!table[i]) throw new Error(`index-CB opcode table incomplete at 0x${i.toString(16)}`);
  }

  return table;
}
