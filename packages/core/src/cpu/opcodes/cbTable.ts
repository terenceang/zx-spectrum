import type { OpcodeFn, OpcodeTable } from "../types.js";
import { ROTATE_OPS, bit8, bitFromMemory, res8, set8 } from "./alu.js";
import { getReg8Plain, setReg8Plain } from "./registerAccess.js";

export function buildCbTable(): OpcodeTable {
  const table: OpcodeFn[] = new Array(256);

  for (let op = 0; op < 8; op++) {
    for (let code = 0; code < 8; code++) {
      const opcode = op * 8 + code;
      if (code === 6) {
        table[opcode] = (cpu) => {
          const addr = cpu.regs.hl;
          const value = cpu.readByte(addr);
          cpu.contend(addr, 1);
          cpu.writeByte(addr, ROTATE_OPS[op]!(cpu, value));
        };
      } else {
        table[opcode] = (cpu) => {
          setReg8Plain(cpu, code, ROTATE_OPS[op]!(cpu, getReg8Plain(cpu, code)));
        };
      }
    }
  }

  for (let bit = 0; bit < 8; bit++) {
    for (let code = 0; code < 8; code++) {
      const opcode = 0x40 + bit * 8 + code;
      if (code === 6) {
        table[opcode] = (cpu) => {
          const addr = cpu.regs.hl;
          const value = cpu.readByte(addr);
          cpu.contend(addr, 1);
          bitFromMemory(cpu, bit, value);
        };
      } else {
        table[opcode] = (cpu) => {
          bit8(cpu, bit, getReg8Plain(cpu, code));
        };
      }
    }
  }

  for (let bit = 0; bit < 8; bit++) {
    for (let code = 0; code < 8; code++) {
      const resOpcode = 0x80 + bit * 8 + code;
      const setOpcode = 0xc0 + bit * 8 + code;
      if (code === 6) {
        table[resOpcode] = (cpu) => {
          const addr = cpu.regs.hl;
          const value = cpu.readByte(addr);
          cpu.contend(addr, 1);
          cpu.writeByte(addr, res8(bit, value));
        };
        table[setOpcode] = (cpu) => {
          const addr = cpu.regs.hl;
          const value = cpu.readByte(addr);
          cpu.contend(addr, 1);
          cpu.writeByte(addr, set8(bit, value));
        };
      } else {
        table[resOpcode] = (cpu) => {
          setReg8Plain(cpu, code, res8(bit, getReg8Plain(cpu, code)));
        };
        table[setOpcode] = (cpu) => {
          setReg8Plain(cpu, code, set8(bit, getReg8Plain(cpu, code)));
        };
      }
    }
  }

  for (let i = 0; i < 256; i++) {
    if (!table[i]) throw new Error(`CB opcode table incomplete at 0x${i.toString(16)}`);
  }

  return table;
}
