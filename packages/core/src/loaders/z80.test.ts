import { describe, expect, it } from "vitest";
import { RegIndex, WordIndex } from "../cpu/registers.js";
import { Machine128k } from "../machines/machine128k.js";
import { Machine48k } from "../machines/machine48k.js";
import { MachinePlus3 } from "../machines/machinePlus3.js";
import { parseZ80, writeZ80128k, writeZ8048k, writeZ80Plus3 } from "./z80.js";

function baseHeaderV1(pc: number, flagsByte: number): Uint8Array {
  const header = new Uint8Array(30);
  header[0] = 0x11; // A
  header[1] = 0x22; // F
  header[6] = pc & 0xff;
  header[7] = (pc >> 8) & 0xff;
  header[8] = 0x00; // SP low
  header[9] = 0x80; // SP high -> SP=0x8000
  header[11] = 0x00; // R low 7 bits
  header[12] = flagsByte;
  header[27] = 1; // iff1
  header[28] = 1; // iff2
  header[29] = 2; // IM 2
  return header;
}

describe("parseZ80", () => {
  it("parses a v1 header with uncompressed RAM", () => {
    const header = baseHeaderV1(0x8000, (3 << 1) | 0x00); // border=3, uncompressed
    const ram = new Uint8Array(49152);
    ram[0] = 0xaa;
    ram[49151] = 0xbb;
    const bytes = new Uint8Array(30 + 49152);
    bytes.set(header, 0);
    bytes.set(ram, 30);

    const snapshot = parseZ80(bytes);

    expect(snapshot.version).toBe(1);
    expect(snapshot.hardwareMode).toBe("48k");
    expect(snapshot.border).toBe(3);
    expect(snapshot.cpu.registerWords[WordIndex.PC]).toBe(0x8000);
    expect(snapshot.cpu.registerBytes[RegIndex.A]).toBe(0x11);
    expect(snapshot.cpu.registerBytes[RegIndex.F]).toBe(0x22);
    expect(snapshot.cpu.im).toBe(2);
    expect(snapshot.ram[0]).toBe(0xaa);
    expect(snapshot.ram[49151]).toBe(0xbb);
  });

  it("parses a v1 header with RLE-compressed RAM", () => {
    const header = baseHeaderV1(0x8000, (3 << 1) | 0x20); // compressed flag set
    // 5 repeats of 0x41, then the v1 end-of-data sentinel.
    const body = Uint8Array.from([0xed, 0xed, 0x05, 0x41, 0x00, 0xed, 0xed, 0x00]);
    const bytes = new Uint8Array(30 + body.length);
    bytes.set(header, 0);
    bytes.set(body, 30);

    const snapshot = parseZ80(bytes);

    expect(snapshot.ram.length).toBe(49152);
    expect(Array.from(snapshot.ram.subarray(0, 5))).toEqual([0x41, 0x41, 0x41, 0x41, 0x41]);
    expect(snapshot.ram[5]).toBe(0);
  });

  it("parses a v2 header (additional length 23) with a single uncompressed page", () => {
    const header = new Uint8Array(32);
    header[6] = 0; // PC=0 in fixed header -> v2/v3
    header[7] = 0;
    header[12] = (5 << 1) | 0x00; // border=5
    header[30] = 23; // additional header length -> v2
    header[31] = 0;
    const extra = new Uint8Array(23);
    extra[0] = 0x00; // PC low = 0x9000
    extra[1] = 0x90;
    extra[2] = 0; // hardware mode 0 = 48k

    const pageHeader = Uint8Array.from([0xff, 0xff, 8]); // 0xFFFF length = uncompressed, page 8 = 0x4000-0x7FFF
    const pageData = new Uint8Array(16384);
    pageData[0] = 0x77;

    const bytes = new Uint8Array(32 + 23 + 3 + 16384);
    bytes.set(header, 0);
    bytes.set(extra, 32);
    bytes.set(pageHeader, 55);
    bytes.set(pageData, 58);

    const snapshot = parseZ80(bytes);

    expect(snapshot.version).toBe(2);
    expect(snapshot.hardwareMode).toBe("48k");
    expect(snapshot.border).toBe(5);
    expect(snapshot.cpu.registerWords[WordIndex.PC]).toBe(0x9000);
    expect(snapshot.ram[0]).toBe(0x77); // page 8 -> RAM offset 0 (0x4000)
  });

  it("decompresses RLE data where uncompressed size far exceeds compressed stream length", () => {
    const header = baseHeaderV1(0x8000, (3 << 1) | 0x20);
    // 8 bytes compressed representing 100 bytes of 0x55
    const body = Uint8Array.from([0xed, 0xed, 100, 0x55, 0x00, 0xed, 0xed, 0x00]);
    const bytes = new Uint8Array(30 + body.length);
    bytes.set(header, 0);
    bytes.set(body, 30);

    const snapshot = parseZ80(bytes);
    expect(snapshot.ram.length).toBe(49152);
    for (let i = 0; i < 100; i++) {
      expect(snapshot.ram[i]).toBe(0x55);
    }
    expect(snapshot.ram[100]).toBe(0);
  });

  it("round-trips Machine48k through writeZ8048k and parseZ80", () => {
    const machine = new Machine48k();
    machine.reset();
    machine.cpu.regs.pc = 0x8123;
    machine.cpu.regs.bytes[RegIndex.A] = 0x5a;
    machine.memory.write8(0x4000, 0x12);
    machine.memory.write8(0x8000, 0x34);
    machine.memory.write8(0xc000, 0x56);

    const bytes = writeZ8048k(machine, 4);
    const parsed = parseZ80(bytes);

    expect(parsed.version).toBe(3);
    expect(parsed.hardwareMode).toBe("48k");
    expect(parsed.border).toBe(4);
    expect(parsed.cpu.registerWords[WordIndex.PC]).toBe(0x8123);
    expect(parsed.cpu.registerBytes[RegIndex.A]).toBe(0x5a);
    expect(parsed.ram[0]).toBe(0x12);
    expect(parsed.ram[0x4000]).toBe(0x34);
    expect(parsed.ram[0x8000]).toBe(0x56);
  });

  it("round-trips Machine128k through writeZ80128k and parseZ80", () => {
    const machine = new Machine128k();
    machine.reset();
    machine.cpu.regs.pc = 0xc050;
    machine.memory.writePagingRegister(0x13); // Rom 1, Bank 3 paged
    machine.memory.pokeBank(3, new Uint8Array(16384).fill(0x33));
    machine.memory.pokeBank(7, new Uint8Array(16384).fill(0x77));
    machine.ay.selectRegister(6);
    machine.ay.writeData(0x1a);

    const bytes = writeZ80128k(machine, 2);
    const parsed = parseZ80(bytes);

    expect(parsed.version).toBe(3);
    expect(parsed.hardwareMode).toBe("128k");
    expect(parsed.border).toBe(2);
    expect(parsed.cpu.registerWords[WordIndex.PC]).toBe(0xc050);
    expect(parsed.port7ffd).toBe(0x13);
    expect(parsed.banks?.length).toBe(8);

    const bank3 = parsed.banks?.find((b) => b.pageNumber === 3 + 3);
    expect(bank3?.data[0]).toBe(0x33);

    expect(parsed.ayRegisters?.[6]).toBe(0x1a);
  });

  it("round-trips MachinePlus3 through writeZ80Plus3 and parseZ80", () => {
    const machine = new MachinePlus3();
    machine.reset();
    machine.cpu.regs.pc = 0x9000;
    machine.memory.writePort7ffd(0x04);
    machine.memory.writePort1ffd(0x08); // Motor on
    machine.memory.pokeBank(4, new Uint8Array(16384).fill(0x44));

    const bytes = writeZ80Plus3(machine, 6);
    const parsed = parseZ80(bytes);

    expect(parsed.version).toBe(3);
    expect(parsed.hardwareMode).toBe("plus3");
    expect(parsed.border).toBe(6);
    expect(parsed.cpu.registerWords[WordIndex.PC]).toBe(0x9000);
    expect(parsed.port7ffd).toBe(0x04);
    expect(parsed.port1ffd).toBe(0x08);
    expect(parsed.banks?.length).toBe(8);

    const bank4 = parsed.banks?.find((b) => b.pageNumber === 4 + 3);
    expect(bank4?.data[0]).toBe(0x44);
  });
});
