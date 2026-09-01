import { describe, expect, it } from "vitest";
import { RegIndex, WordIndex } from "../cpu/registers.js";
import { parseSna } from "./sna.js";

function buildSna48k(overrides: { sp: number; border: number; ram: [number, number][] }) {
  const bytes = new Uint8Array(27 + 49152);
  bytes[0] = 0x3f; // I
  bytes[19] = 0x04; // iff2 bit set
  bytes[20] = 0x7f; // R
  bytes[21] = 0x41; // F
  bytes[22] = 0x42; // A
  bytes[23] = overrides.sp & 0xff;
  bytes[24] = (overrides.sp >> 8) & 0xff;
  bytes[25] = 1; // IM
  bytes[26] = overrides.border & 0x07;
  for (const [offset, value] of overrides.ram) {
    bytes[27 + offset] = value;
  }
  return bytes;
}

describe("parseSna", () => {
  it("parses the 27-byte header and reconstructs PC from the stack", () => {
    // SP = 0x8000 -> RAM offset 0x4000; poke a little-endian PC there.
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
