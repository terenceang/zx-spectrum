import { describe, expect, it } from "vitest";
import { RegIndex, WordIndex } from "../cpu/registers.js";
import { parseZ80 } from "./z80.js";

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
});
