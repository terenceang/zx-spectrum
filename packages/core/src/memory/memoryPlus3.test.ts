import { describe, expect, it } from "vitest";
import { ROM_PAGE_SIZE } from "./constants.js";
import { MemoryPlus3 } from "./memoryPlus3.js";

describe("MemoryPlus3", () => {
  it("pages all 4 ROMs correctly based on 0x7FFD bit 4 and 0x1FFD bit 2", () => {
    const mem = new MemoryPlus3();
    for (let i = 0; i < 4; i++) {
      const rom = new Uint8Array(ROM_PAGE_SIZE).fill(0x10 * (i + 1));
      mem.loadRom(i as 0 | 1 | 2 | 3, rom);
    }

    // ROM 0: 1ffd.bit2=0, 7ffd.bit4=0
    mem.writePort1ffd(0x00);
    mem.writePort7ffd(0x00);
    expect(mem.romBank).toBe(0);
    expect(mem.read8(0x0000)).toBe(0x10);

    // ROM 1: 1ffd.bit2=0, 7ffd.bit4=1
    mem.writePort7ffd(0x10);
    expect(mem.romBank).toBe(1);
    expect(mem.read8(0x0000)).toBe(0x20);

    // ROM 2: 1ffd.bit2=1, 7ffd.bit4=0
    mem.writePort1ffd(0x04);
    mem.writePort7ffd(0x00);
    expect(mem.romBank).toBe(2);
    expect(mem.read8(0x0000)).toBe(0x30);

    // ROM 3: 1ffd.bit2=1, 7ffd.bit4=1
    mem.writePort7ffd(0x10);
    expect(mem.romBank).toBe(3);
    expect(mem.read8(0x0000)).toBe(0x40);

    // ROM writes are no-ops
    mem.write8(0x0000, 0xff);
    expect(mem.read8(0x0000)).toBe(0x40);
  });

  it("normal mode maps RAM bank 5 to slot 1, bank 2 to slot 2, and paged bank to slot 3", () => {
    const mem = new MemoryPlus3();
    mem.pokeBank(5, new Uint8Array(ROM_PAGE_SIZE).fill(0x55));
    mem.pokeBank(2, new Uint8Array(ROM_PAGE_SIZE).fill(0x22));
    mem.pokeBank(0, new Uint8Array(ROM_PAGE_SIZE).fill(0xa0));
    mem.pokeBank(3, new Uint8Array(ROM_PAGE_SIZE).fill(0xa3));

    expect(mem.read8(0x4000)).toBe(0x55);
    expect(mem.read8(0x8000)).toBe(0x22);

    mem.writePort7ffd(0x00); // slot 3 = bank 0
    expect(mem.read8(0xc000)).toBe(0xa0);

    mem.writePort7ffd(0x03); // slot 3 = bank 3
    expect(mem.read8(0xc000)).toBe(0xa3);
  });

  it("handles special all-RAM mode configurations", () => {
    const mem = new MemoryPlus3();
    for (let b = 0; b < 8; b++) {
      mem.pokeBank(b, new Uint8Array(ROM_PAGE_SIZE).fill(0x80 + b));
    }

    // Config 0: Banks 0, 1, 2, 3 (1ffd = 0x01)
    mem.writePort1ffd(0x01);
    expect(mem.isSpecialMode).toBe(true);
    expect(mem.read8(0x0000)).toBe(0x80);
    expect(mem.read8(0x4000)).toBe(0x81);
    expect(mem.read8(0x8000)).toBe(0x82);
    expect(mem.read8(0xc000)).toBe(0x83);

    // In all-RAM mode, slot 0 is writable
    mem.write8(0x0000, 0x42);
    expect(mem.read8(0x0000)).toBe(0x42);
    expect(mem.peekBank(0)[0]).toBe(0x42);

    // Config 1: Banks 4, 5, 6, 7 (1ffd = 0x03)
    mem.writePort1ffd(0x03);
    expect(mem.read8(0x0000)).toBe(0x84);
    expect(mem.read8(0x4000)).toBe(0x85);
    expect(mem.read8(0x8000)).toBe(0x86);
    expect(mem.read8(0xc000)).toBe(0x87);

    // Config 2: Banks 4, 5, 6, 3 (1ffd = 0x05)
    mem.writePort1ffd(0x05);
    expect(mem.read8(0x0000)).toBe(0x84);
    expect(mem.read8(0x4000)).toBe(0x85);
    expect(mem.read8(0x8000)).toBe(0x86);
    expect(mem.read8(0xc000)).toBe(0x83);

    // Config 3: Banks 4, 7, 6, 3 (1ffd = 0x07)
    mem.writePort1ffd(0x07);
    expect(mem.read8(0x0000)).toBe(0x84);
    expect(mem.read8(0x4000)).toBe(0x87);
    expect(mem.read8(0x8000)).toBe(0x86);
    expect(mem.read8(0xc000)).toBe(0x83);
  });

  it("+3 contention flags banks 4, 5, 6, 7 as contended, banks 0-3 and ROM as uncontended", () => {
    const mem = new MemoryPlus3();
    // Normal mode: slot 0=ROM (uncontended), slot 1=Bank 5 (contended), slot 2=Bank 2 (uncontended), slot 3=Bank 0 (uncontended)
    mem.writePort1ffd(0x00);
    mem.writePort7ffd(0x00);
    expect(mem.isContended(0x1000)).toBe(false);
    expect(mem.isContended(0x4000)).toBe(true);
    expect(mem.isContended(0x8000)).toBe(false);
    expect(mem.isContended(0xc000)).toBe(false);

    // Map bank 7 into slot 3 (contended)
    mem.writePort7ffd(0x07);
    expect(mem.isContended(0xc000)).toBe(true);
  });

  it("locks paging when 0x7FFD bit 5 is written", () => {
    const mem = new MemoryPlus3();
    mem.writePort7ffd(0x20); // lock paging
    expect(mem.isPagingLocked).toBe(true);

    mem.writePort7ffd(0x03);
    expect(mem.port7ffd).toBe(0x20);

    mem.writePort1ffd(0x01);
    expect(mem.port1ffd).toBe(0x00);

    mem.reset();
    expect(mem.isPagingLocked).toBe(false);
  });

  it("switches screenBytes between Bank 5 and Bank 7", () => {
    const mem = new MemoryPlus3();
    mem.peekBank(5)[0] = 0x55;
    mem.peekBank(7)[0] = 0x77;

    mem.writePort7ffd(0x00);
    expect(mem.screenBytes[0]).toBe(0x55);

    mem.writePort7ffd(0x08); // bit 3 set
    expect(mem.screenBytes[0]).toBe(0x77);
  });
});
