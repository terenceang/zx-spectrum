import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MemoryAccessTag, Z80Bus } from "./bus.js";
import { RegIndex } from "./registers.js";
import { Z80 } from "./z80.js";

const FIXTURES_DIR = new URL("../../../test-fixtures/cpu/", import.meta.url);

function runCpmProgram(binary: Uint8Array, maxInstructions: number): string {
  const memory = new Uint8Array(0x10000);
  memory.set(binary, 0x100);

  let output = "";

  const bus: Z80Bus = {
    tStates: 0,
    readMemory(address: number, _tag: MemoryAccessTag): number {
      return memory[address & 0xffff]!;
    },
    writeMemory(address: number, value: number, _tag: MemoryAccessTag): void {
      memory[address & 0xffff] = value & 0xff;
    },
    contend(): void {},
    readPort(): number {
      return 0xff;
    },
    writePort(): void {},
    nmiPending: () => false,
    intPending: () => false,
    readInterruptDataBus: () => 0xff,
    clearNmiPending: () => {},
  };

  const cpu = new Z80(bus);
  cpu.regs.pc = 0x100;
  cpu.regs.sp = 0xfffe;

  for (let i = 0; i < maxInstructions; i++) {
    const pc = cpu.regs.pc;

    if (pc === 0x0000) break;

    if (pc === 0x0005) {
      const c = cpu.regs.bytes[RegIndex.C]!;
      if (c === 2) {
        output += String.fromCharCode(cpu.regs.bytes[RegIndex.E]!);
      } else if (c === 9) {
        let addr = cpu.regs.de;
        while (memory[addr & 0xffff] !== 0x24) {
          output += String.fromCharCode(memory[addr & 0xffff]!);
          addr = (addr + 1) & 0xffff;
        }
      }
      const low = memory[cpu.regs.sp]!;
      const high = memory[(cpu.regs.sp + 1) & 0xffff]!;
      cpu.regs.sp = (cpu.regs.sp + 2) & 0xffff;
      cpu.regs.pc = (high << 8) | low;
      continue;
    }

    cpu.step();
  }

  return output;
}

describe("Z80 core vs. zexdoc/zexall", () => {
  it("passes zexdoc (documented instructions and flags)", () => {
    const binary = readFileSync(new URL("zexdoc.com", FIXTURES_DIR));
    const output = runCpmProgram(binary, 20_000_000_000);
    expect(output).not.toContain("ERROR");
    expect(output).toContain("Tests complete");
  }, 600_000);

  it("passes zexall (documented + undocumented flags)", () => {
    const binary = readFileSync(new URL("zexall.com", FIXTURES_DIR));
    const output = runCpmProgram(binary, 20_000_000_000);
    expect(output).not.toContain("ERROR");
    expect(output).toContain("Tests complete");
  }, 600_000);
});
