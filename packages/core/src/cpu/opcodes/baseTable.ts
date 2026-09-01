import { Flag } from "../flags.js";
import { RegIndex } from "../registers.js";
import type { OpcodeFn, OpcodeTable } from "../types.js";
import type { Z80 } from "../z80.js";
import {
  add8,
  add16,
  and8,
  ccf,
  cp8,
  cpl,
  daa,
  dec8,
  inc8,
  or8,
  rla,
  rlca,
  rra,
  rrca,
  scf,
  sub8,
  xor8,
} from "./alu.js";
import { getReg8Plain, setReg8Plain } from "./registerAccess.js";

// Base (unprefixed) opcode map. Built with small loops for the highly repetitive
// families (LD r,r'; ALU A,r; INC/DEC r; LD r,n) rather than 256 hand-written
// functions, per the plan's table-builder approach. T-state accounting: every
// opcode fetch/data/stack bus call already carries its documented base cost (4/3/3
// respectively, enforced by the machine's Z80Bus implementation), so each handler
// below only needs an explicit `cpu.contend()` call for the *extra* internal cycles
// beyond those base bus accesses, matching the standard published Z80 timing tables.
//
// Known simplification: `contend()` calls for purely-internal (no new bus access)
// delays use `cpu.regs.pc` as the "address held on the bus" — real hardware holds
// the IR (I/R) pair on the bus during some of these cycles instead. This gives the
// correct *total* T-state count (verified against zexall/zexdoc, which don't check
// timing) and the correct contention *shape* in the common case, but is not a
// per-cycle-exact contended-address model; revisit if precise contended-timing
// conformance (e.g. against FUSE's contended-memory test suite) is needed later.

export const CONDITIONS: readonly ((cpu: Z80) => boolean)[] = [
  (cpu) => !cpu.getFlag(Flag.Z),
  (cpu) => cpu.getFlag(Flag.Z),
  (cpu) => !cpu.getFlag(Flag.C),
  (cpu) => cpu.getFlag(Flag.C),
  (cpu) => !cpu.getFlag(Flag.PV),
  (cpu) => cpu.getFlag(Flag.PV),
  (cpu) => !cpu.getFlag(Flag.S),
  (cpu) => cpu.getFlag(Flag.S),
];

export const ALU_OPS: readonly ((cpu: Z80, value: number) => void)[] = [
  (cpu, v) => add8(cpu, v, 0),
  (cpu, v) => add8(cpu, v, cpu.getFlag(Flag.C) ? 1 : 0),
  (cpu, v) => sub8(cpu, v, 0),
  (cpu, v) => sub8(cpu, v, cpu.getFlag(Flag.C) ? 1 : 0),
  and8,
  xor8,
  or8,
  cp8,
];

function makeJrCc(condition: (cpu: Z80) => boolean): OpcodeFn {
  return (cpu) => {
    const d = cpu.fetchDisplacement();
    if (condition(cpu)) {
      cpu.contend(cpu.regs.pc, 5);
      cpu.regs.pc = (cpu.regs.pc + d) & 0xffff;
      cpu.regs.memptr = cpu.regs.pc;
    }
  };
}

function makeJpCc(condition: (cpu: Z80) => boolean): OpcodeFn {
  return (cpu) => {
    const addr = cpu.fetchOperandWord();
    cpu.regs.memptr = addr;
    if (condition(cpu)) cpu.regs.pc = addr;
  };
}

function makeCallCc(condition: (cpu: Z80) => boolean): OpcodeFn {
  return (cpu) => {
    const addr = cpu.fetchOperandWord();
    cpu.regs.memptr = addr;
    if (condition(cpu)) {
      cpu.contend(cpu.regs.pc, 1);
      cpu.push(cpu.regs.pc);
      cpu.regs.pc = addr;
    }
  };
}

function makeRetCc(condition: (cpu: Z80) => boolean): OpcodeFn {
  return (cpu) => {
    cpu.contend(cpu.regs.pc, 1);
    if (condition(cpu)) {
      const addr = cpu.pop();
      cpu.regs.pc = addr;
      cpu.regs.memptr = addr;
    }
  };
}

export function buildBaseTable(): OpcodeTable {
  const table: OpcodeFn[] = new Array(256);

  const prefixReached: OpcodeFn = () => {
    throw new Error("prefix byte reached base-table dispatch: dispatcher bug");
  };
  table[0xcb] = prefixReached;
  table[0xed] = prefixReached;
  table[0xdd] = prefixReached;
  table[0xfd] = prefixReached;

  // ---- LD r,r' (0x40-0x7F, 0x76 = HALT) ----
  for (let dest = 0; dest < 8; dest++) {
    for (let src = 0; src < 8; src++) {
      const opcode = 0x40 + dest * 8 + src;
      if (opcode === 0x76) continue;
      table[opcode] = (cpu) => {
        setReg8Plain(cpu, dest, getReg8Plain(cpu, src));
      };
    }
  }
  table[0x76] = (cpu) => {
    cpu.halted = true;
  };

  // ---- ALU A,r (0x80-0xBF) ----
  for (let op = 0; op < 8; op++) {
    for (let src = 0; src < 8; src++) {
      const opcode = 0x80 + op * 8 + src;
      table[opcode] = (cpu) => {
        ALU_OPS[op]!(cpu, getReg8Plain(cpu, src));
      };
    }
  }

  // ---- INC r / DEC r (0x04+8k / 0x05+8k) and LD r,n (0x06+8k) ----
  for (let code = 0; code < 8; code++) {
    const incOpcode = code * 8 + 4;
    const decOpcode = code * 8 + 5;
    const ldOpcode = code * 8 + 6;
    if (code === 6) {
      table[incOpcode] = (cpu) => {
        const addr = cpu.regs.hl;
        const value = cpu.readByte(addr);
        cpu.contend(addr, 1);
        cpu.writeByte(addr, inc8(cpu, value));
      };
      table[decOpcode] = (cpu) => {
        const addr = cpu.regs.hl;
        const value = cpu.readByte(addr);
        cpu.contend(addr, 1);
        cpu.writeByte(addr, dec8(cpu, value));
      };
      table[ldOpcode] = (cpu) => {
        const n = cpu.fetchOperandByte();
        cpu.writeByte(cpu.regs.hl, n);
      };
    } else {
      table[incOpcode] = (cpu) => {
        setReg8Plain(cpu, code, inc8(cpu, getReg8Plain(cpu, code)));
      };
      table[decOpcode] = (cpu) => {
        setReg8Plain(cpu, code, dec8(cpu, getReg8Plain(cpu, code)));
      };
      table[ldOpcode] = (cpu) => {
        setReg8Plain(cpu, code, cpu.fetchOperandByte());
      };
    }
  }

  // ---- ALU A,n (0xC6,0xCE,0xD6,0xDE,0xE6,0xEE,0xF6,0xFE) ----
  for (let op = 0; op < 8; op++) {
    const opcode = 0xc6 + op * 8;
    table[opcode] = (cpu) => {
      ALU_OPS[op]!(cpu, cpu.fetchOperandByte());
    };
  }

  // ---- RST n ----
  for (let i = 0; i < 8; i++) {
    const opcode = 0xc7 + i * 8;
    const target = i * 8;
    table[opcode] = (cpu) => {
      cpu.contend(cpu.regs.pc, 1);
      cpu.push(cpu.regs.pc);
      cpu.regs.pc = target;
      cpu.regs.memptr = target;
    };
  }

  // ---- conditional JR/JP/CALL/RET ----
  for (let cc = 0; cc < 8; cc++) {
    table[0xc0 + cc * 8] = makeRetCc(CONDITIONS[cc]!);
    table[0xc2 + cc * 8] = makeJpCc(CONDITIONS[cc]!);
    table[0xc4 + cc * 8] = makeCallCc(CONDITIONS[cc]!);
  }
  for (let cc = 0; cc < 4; cc++) {
    table[0x20 + cc * 8] = makeJrCc(CONDITIONS[cc]!);
  }

  // ---- 16-bit LD rr,nn / INC rr / DEC rr / ADD HL,rr ----
  table[0x01] = (cpu) => (cpu.regs.bc = cpu.fetchOperandWord());
  table[0x11] = (cpu) => (cpu.regs.de = cpu.fetchOperandWord());
  table[0x21] = (cpu) => (cpu.regs.hl = cpu.fetchOperandWord());
  table[0x31] = (cpu) => (cpu.regs.sp = cpu.fetchOperandWord());

  table[0x03] = (cpu) => {
    cpu.contend(cpu.regs.pc, 2);
    cpu.regs.bc = (cpu.regs.bc + 1) & 0xffff;
  };
  table[0x13] = (cpu) => {
    cpu.contend(cpu.regs.pc, 2);
    cpu.regs.de = (cpu.regs.de + 1) & 0xffff;
  };
  table[0x23] = (cpu) => {
    cpu.contend(cpu.regs.pc, 2);
    cpu.regs.hl = (cpu.regs.hl + 1) & 0xffff;
  };
  table[0x33] = (cpu) => {
    cpu.contend(cpu.regs.pc, 2);
    cpu.regs.sp = (cpu.regs.sp + 1) & 0xffff;
  };

  table[0x0b] = (cpu) => {
    cpu.contend(cpu.regs.pc, 2);
    cpu.regs.bc = (cpu.regs.bc - 1) & 0xffff;
  };
  table[0x1b] = (cpu) => {
    cpu.contend(cpu.regs.pc, 2);
    cpu.regs.de = (cpu.regs.de - 1) & 0xffff;
  };
  table[0x2b] = (cpu) => {
    cpu.contend(cpu.regs.pc, 2);
    cpu.regs.hl = (cpu.regs.hl - 1) & 0xffff;
  };
  table[0x3b] = (cpu) => {
    cpu.contend(cpu.regs.pc, 2);
    cpu.regs.sp = (cpu.regs.sp - 1) & 0xffff;
  };

  table[0x09] = (cpu) => {
    cpu.contend(cpu.regs.pc, 7);
    cpu.regs.hl = add16(cpu, cpu.regs.hl, cpu.regs.bc);
  };
  table[0x19] = (cpu) => {
    cpu.contend(cpu.regs.pc, 7);
    cpu.regs.hl = add16(cpu, cpu.regs.hl, cpu.regs.de);
  };
  table[0x29] = (cpu) => {
    cpu.contend(cpu.regs.pc, 7);
    cpu.regs.hl = add16(cpu, cpu.regs.hl, cpu.regs.hl);
  };
  table[0x39] = (cpu) => {
    cpu.contend(cpu.regs.pc, 7);
    cpu.regs.hl = add16(cpu, cpu.regs.hl, cpu.regs.sp);
  };

  // ---- PUSH/POP ----
  table[0xc1] = (cpu) => (cpu.regs.bc = cpu.pop());
  table[0xd1] = (cpu) => (cpu.regs.de = cpu.pop());
  table[0xe1] = (cpu) => (cpu.regs.hl = cpu.pop());
  table[0xf1] = (cpu) => (cpu.regs.af = cpu.pop());
  table[0xc5] = (cpu) => {
    cpu.contend(cpu.regs.pc, 1);
    cpu.push(cpu.regs.bc);
  };
  table[0xd5] = (cpu) => {
    cpu.contend(cpu.regs.pc, 1);
    cpu.push(cpu.regs.de);
  };
  table[0xe5] = (cpu) => {
    cpu.contend(cpu.regs.pc, 1);
    cpu.push(cpu.regs.hl);
  };
  table[0xf5] = (cpu) => {
    cpu.contend(cpu.regs.pc, 1);
    cpu.push(cpu.regs.af);
  };

  // ---- unconditional CALL/JP/RET ----
  table[0xc3] = (cpu) => {
    const addr = cpu.fetchOperandWord();
    cpu.regs.memptr = addr;
    cpu.regs.pc = addr;
  };
  table[0xcd] = (cpu) => {
    const addr = cpu.fetchOperandWord();
    cpu.regs.memptr = addr;
    cpu.contend(cpu.regs.pc, 1);
    cpu.push(cpu.regs.pc);
    cpu.regs.pc = addr;
  };
  table[0xc9] = (cpu) => {
    const addr = cpu.pop();
    cpu.regs.pc = addr;
    cpu.regs.memptr = addr;
  };

  // ---- misc row 0x00-0x3F ----
  table[0x00] = () => {};

  table[0x02] = (cpu) => {
    const a = cpu.regs.bytes[RegIndex.A]!;
    cpu.writeByte(cpu.regs.bc, a);
    cpu.regs.memptr = (a << 8) | ((cpu.regs.bc + 1) & 0xff);
  };
  table[0x12] = (cpu) => {
    const a = cpu.regs.bytes[RegIndex.A]!;
    cpu.writeByte(cpu.regs.de, a);
    cpu.regs.memptr = (a << 8) | ((cpu.regs.de + 1) & 0xff);
  };
  table[0x0a] = (cpu) => {
    const addr = cpu.regs.bc;
    cpu.regs.bytes[RegIndex.A] = cpu.readByte(addr);
    cpu.regs.memptr = (addr + 1) & 0xffff;
  };
  table[0x1a] = (cpu) => {
    const addr = cpu.regs.de;
    cpu.regs.bytes[RegIndex.A] = cpu.readByte(addr);
    cpu.regs.memptr = (addr + 1) & 0xffff;
  };

  table[0x07] = rlca;
  table[0x0f] = rrca;
  table[0x17] = rla;
  table[0x1f] = rra;
  table[0x27] = daa;
  table[0x2f] = cpl;
  table[0x37] = scf;
  table[0x3f] = ccf;

  table[0x08] = (cpu) => {
    const a = cpu.regs.bytes[RegIndex.A]!;
    const f = cpu.regs.bytes[RegIndex.F]!;
    cpu.regs.bytes[RegIndex.A] = cpu.regs.bytes[RegIndex.A_]!;
    cpu.regs.bytes[RegIndex.F] = cpu.regs.bytes[RegIndex.F_]!;
    cpu.regs.bytes[RegIndex.A_] = a;
    cpu.regs.bytes[RegIndex.F_] = f;
  };
  table[0xd9] = (cpu) => {
    const b = cpu.regs.bc;
    const d = cpu.regs.de;
    const h = cpu.regs.hl;
    cpu.regs.bc = (cpu.regs.bytes[RegIndex.B_]! << 8) | cpu.regs.bytes[RegIndex.C_]!;
    cpu.regs.de = (cpu.regs.bytes[RegIndex.D_]! << 8) | cpu.regs.bytes[RegIndex.E_]!;
    cpu.regs.hl = (cpu.regs.bytes[RegIndex.H_]! << 8) | cpu.regs.bytes[RegIndex.L_]!;
    cpu.regs.bytes[RegIndex.B_] = b >> 8;
    cpu.regs.bytes[RegIndex.C_] = b & 0xff;
    cpu.regs.bytes[RegIndex.D_] = d >> 8;
    cpu.regs.bytes[RegIndex.E_] = d & 0xff;
    cpu.regs.bytes[RegIndex.H_] = h >> 8;
    cpu.regs.bytes[RegIndex.L_] = h & 0xff;
  };

  table[0x10] = (cpu) => {
    cpu.contend(cpu.regs.pc, 1);
    cpu.regs.bytes[RegIndex.B] = (cpu.regs.bytes[RegIndex.B]! - 1) & 0xff;
    const d = cpu.fetchDisplacement();
    if (cpu.regs.bytes[RegIndex.B] !== 0) {
      cpu.contend(cpu.regs.pc, 5);
      cpu.regs.pc = (cpu.regs.pc + d) & 0xffff;
      cpu.regs.memptr = cpu.regs.pc;
    }
  };
  table[0x18] = (cpu) => {
    const d = cpu.fetchDisplacement();
    cpu.contend(cpu.regs.pc, 5);
    cpu.regs.pc = (cpu.regs.pc + d) & 0xffff;
    cpu.regs.memptr = cpu.regs.pc;
  };

  table[0x22] = (cpu) => {
    const addr = cpu.fetchOperandWord();
    cpu.writeWord(addr, cpu.regs.hl);
    cpu.regs.memptr = (addr + 1) & 0xffff;
  };
  table[0x2a] = (cpu) => {
    const addr = cpu.fetchOperandWord();
    cpu.regs.hl = cpu.readWord(addr);
    cpu.regs.memptr = (addr + 1) & 0xffff;
  };
  table[0x32] = (cpu) => {
    const addr = cpu.fetchOperandWord();
    const a = cpu.regs.bytes[RegIndex.A]!;
    cpu.writeByte(addr, a);
    cpu.regs.memptr = (a << 8) | ((addr + 1) & 0xff);
  };
  table[0x3a] = (cpu) => {
    const addr = cpu.fetchOperandWord();
    cpu.regs.bytes[RegIndex.A] = cpu.readByte(addr);
    cpu.regs.memptr = (addr + 1) & 0xffff;
  };

  // ---- I/O, exchanges, interrupt control, misc 0xC0-0xFF leftovers ----
  table[0xd3] = (cpu) => {
    const n = cpu.fetchOperandByte();
    const a = cpu.regs.bytes[RegIndex.A]!;
    const port = (a << 8) | n;
    cpu.writePort(port, a);
    cpu.regs.memptr = (a << 8) | ((n + 1) & 0xff);
  };
  table[0xdb] = (cpu) => {
    const n = cpu.fetchOperandByte();
    const a = cpu.regs.bytes[RegIndex.A]!;
    const port = (a << 8) | n;
    cpu.regs.bytes[RegIndex.A] = cpu.readPort(port);
    cpu.regs.memptr = (port + 1) & 0xffff;
  };

  table[0xe3] = (cpu) => {
    const sp = cpu.regs.sp;
    const low = cpu.readByte(sp);
    const high = cpu.readByte((sp + 1) & 0xffff);
    cpu.contend((sp + 1) & 0xffff, 1);
    const oldHl = cpu.regs.hl;
    cpu.writeByte((sp + 1) & 0xffff, (oldHl >> 8) & 0xff);
    cpu.writeByte(sp, oldHl & 0xff);
    cpu.contend(sp, 2);
    cpu.regs.hl = (high << 8) | low;
    cpu.regs.memptr = cpu.regs.hl;
  };
  table[0xe9] = (cpu) => {
    cpu.regs.pc = cpu.regs.hl;
  };
  table[0xeb] = (cpu) => {
    const de = cpu.regs.de;
    cpu.regs.de = cpu.regs.hl;
    cpu.regs.hl = de;
  };
  table[0xf9] = (cpu) => {
    cpu.contend(cpu.regs.pc, 2);
    cpu.regs.sp = cpu.regs.hl;
  };

  table[0xf3] = (cpu) => {
    cpu.iff1 = false;
    cpu.iff2 = false;
  };
  table[0xfb] = (cpu) => {
    cpu.iff1 = true;
    cpu.iff2 = true;
    cpu.interruptsSuppressedForOneStep = true;
  };

  for (let i = 0; i < 256; i++) {
    if (!table[i]) {
      throw new Error(`base opcode table incomplete at 0x${i.toString(16)}`);
    }
  }

  return table;
}
