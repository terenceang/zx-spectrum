import { describe, expect, it } from "vitest";
import { RegIndex, WordIndex } from "../cpu/registers.js";
import { applySnapshotTo128k, applySnapshotTo48k } from "./apply.js";
import { Machine128k } from "../machines/machine128k.js";
import { Machine48k } from "../machines/machine48k.js";
import { parseSna, writeSna128k, writeSna48k } from "./sna.js";

function buildSna48k(overrides: { sp: number; border: number; ram: [number, number][] }) {
  const bytes = new Uint8Array(27 + 49152);
  bytes[0] = 0x3f;
  bytes[19] = 0x04;
  bytes[20] = 0x7f;
  bytes[21] = 0x41;
  bytes[22] = 0x42;
  bytes[23] = overrides.sp & 0xff;
  bytes[24] = (overrides.sp >> 8) & 0xff;
  bytes[25] = 1;
  bytes[26] = overrides.border & 0x07;
  for (const [offset, value] of overrides.ram) {
    bytes[27 + offset] = value;
  }
  return bytes;
}

describe("parseSna", () => {
  it("parses the 27-byte header and reconstructs PC from the stack", () => {
    const bytes = buildSna48k({
      sp: 0x8000,
      border: 3,
      ram: [
        [0x4000, 0x34],
        [0x4001, 0x12],
      ],
    });

    const snapshot = parseSna(bytes);

    expect(snapshot.model).toBe("48k");
    expect(snapshot.border).toBe(3);
    expect(snapshot.cpu.registerBytes[RegIndex.I]).toBe(0x3f);
    expect(snapshot.cpu.registerBytes[RegIndex.F]).toBe(0x41);
    expect(snapshot.cpu.registerBytes[RegIndex.A]).toBe(0x42);
    expect(snapshot.cpu.iff1).toBe(true);
    expect(snapshot.cpu.iff2).toBe(true);
    expect(snapshot.cpu.im).toBe(1);
    expect(snapshot.cpu.registerWords[WordIndex.PC]).toBe(0x1234);
    expect(snapshot.cpu.registerWords[WordIndex.SP]).toBe(0x8002);
    expect(snapshot.ram.length).toBe(49152);
  });

  it("rejects a file with the wrong length", () => {
    expect(() => parseSna(new Uint8Array(100))).toThrow();
  });
});

describe("writeSna48k", () => {
  it("round-trips through parseSna and applySnapshotTo48k", () => {
    const machine = new Machine48k();
    machine.reset();
    machine.memory.poke8(0x8000, 0xaa);
    machine.memory.poke8(0xffff, 0x55);
    machine.cpu.regs.pc = 0x6789;
    machine.cpu.regs.sp = 0x8100;
    machine.cpu.regs.bytes[RegIndex.A] = 0x42;
    machine.ula.setBorder(5);

    const bytes = writeSna48k(machine, machine.ula.borderColor);
    expect(bytes.length).toBe(27 + 49152);

    const snapshot = parseSna(bytes);
    expect(snapshot.border).toBe(5);
    expect(snapshot.cpu.registerWords[WordIndex.PC]).toBe(0x6789);
    expect(snapshot.cpu.registerWords[WordIndex.SP]).toBe(0x8100);
    expect(snapshot.cpu.registerBytes[RegIndex.A]).toBe(0x42);
    expect(snapshot.ram[0x8000 - 0x4000]).toBe(0xaa);
    expect(snapshot.ram[0xffff - 0x4000]).toBe(0x55);

    const reloaded = new Machine48k();
    applySnapshotTo48k(reloaded, snapshot);
    expect(reloaded.cpu.regs.pc).toBe(0x6789);
    expect(reloaded.cpu.regs.sp).toBe(0x8100);
    expect(reloaded.memory.read8(0x8000)).toBe(0xaa);
    expect(reloaded.memory.read8(0xffff)).toBe(0x55);
  });
});

describe("writeSna128k", () => {
  it("round-trips through parseSna and applySnapshotTo128k, including banked RAM", () => {
    const machine = new Machine128k();
    machine.reset();
    machine.memory.writePagingRegister(0x03);
    machine.memory.poke8(0x4000, 0x11);
    machine.memory.poke8(0x8000, 0x22);
    machine.memory.poke8(0xc000, 0x33);
    machine.memory.pokeBank(6, new Uint8Array(16384).fill(0x66));
    machine.cpu.regs.pc = 0xabcd;
    machine.cpu.regs.sp = 0xff00;
    machine.ula.setBorder(2);

    const bytes = writeSna128k(machine, machine.ula.borderColor);

    const snapshot = parseSna(bytes);
    expect(snapshot.model).toBe("128k");
    expect(snapshot.cpu.registerWords[WordIndex.PC]).toBe(0xabcd);
    expect(snapshot.cpu.registerWords[WordIndex.SP]).toBe(0xff00);
    expect(snapshot.port7ffd).toBe(0x03);
    const bank6 = snapshot.pagedBanks?.find((b) => b.bank === 6);
    expect(bank6?.data.every((byte) => byte === 0x66)).toBe(true);

    const reloaded = new Machine128k();
    applySnapshotTo128k(reloaded, snapshot);
    expect(reloaded.cpu.regs.pc).toBe(0xabcd);
    reloaded.memory.writePagingRegister(0x00);
    expect(reloaded.memory.read8(0x4000)).toBe(0x11);
    expect(reloaded.memory.read8(0x8000)).toBe(0x22);
    reloaded.memory.writePagingRegister(0x03);
    expect(reloaded.memory.read8(0xc000)).toBe(0x33);
    reloaded.memory.writePagingRegister(0x06);
    expect(reloaded.memory.read8(0xc000)).toBe(0x66);
  });
});
