import { describe, expect, it } from "vitest";
import { parseTzx } from "./tzx.js";

function tzxHeader(): number[] {
  return [..."ZXTape!".split("").map((c) => c.charCodeAt(0)), 0x1a, 1, 20];
}

describe("parseTzx", () => {
  it("rejects a file without the ZXTape! signature", () => {
    expect(() => parseTzx(new Uint8Array([1, 2, 3]))).toThrow(/signature/);
  });

  it("parses a Pure Tone block (0x12) into repeated same-duration pulses", () => {
    const bytes = Uint8Array.from([
      ...tzxHeader(),
      0x12,
      0xe8,
      0x08, // pulse length 2280 (LE)
      0x05,
      0x00, // count 5
    ]);
    const pulses = parseTzx(bytes);
    expect(pulses).toHaveLength(5);
    for (const p of pulses) expect(p.duration).toBe(0x08e8);
  });

  it("parses a Pulse Sequence block (0x13) with explicit lengths", () => {
    const bytes = Uint8Array.from([
      ...tzxHeader(),
      0x13,
      0x02, // 2 pulses
      0x10,
      0x00, // 16
      0x20,
      0x00, // 32
    ]);
    const pulses = parseTzx(bytes);
    expect(pulses.map((p) => p.duration)).toEqual([16, 32]);
  });

  it("parses a Standard Speed Data block (0x10) with a trailing pause", () => {
    const data = Uint8Array.from([0xff, 0x01]); // flag=0xFF -> short (data) pilot
    const bytes = Uint8Array.from([
      ...tzxHeader(),
      0x10,
      0xe8,
      0x03, // pause 1000ms (LE)
      data.length,
      0x00,
      ...data,
    ]);
    const pulses = parseTzx(bytes);
    expect(pulses.length).toBeGreaterThan(0);
    expect(pulses.at(-1)!.duration).toBe(1000 * 3500);
    expect(pulses.at(-1)!.level).toBe(0);
  });

  it("skips a Text Description block (0x30) without producing pulses", () => {
    const text = "hello";
    const bytes = Uint8Array.from([
      ...tzxHeader(),
      0x30,
      text.length,
      ...text.split("").map((c) => c.charCodeAt(0)),
    ]);
    expect(parseTzx(bytes)).toEqual([]);
  });

  it("throws a clear error on an unsupported block ID", () => {
    const bytes = Uint8Array.from([...tzxHeader(), 0x19]);
    expect(() => parseTzx(bytes)).toThrow(/0x19/);
  });

  it("keeps every pulse a real edge across a multi-block pause boundary", () => {
    // Same bug class as tap.test.ts's equivalent test: the pause after a Standard
    // Speed Data block must not merge into the next block's first pilot pulse.
    function speedDataBlock(data: number[]): number[] {
      return [0x10, 0xe8, 0x03, data.length, 0x00, ...data]; // 1000ms pause
    }
    const bytes = Uint8Array.from([
      ...tzxHeader(),
      ...speedDataBlock([0x00, 0x01]),
      ...speedDataBlock([0xff, 0x02]),
    ]);

    const pulses = parseTzx(bytes);
    for (let i = 1; i < pulses.length; i++) {
      expect(pulses[i]!.level, `pulses[${i}] repeats the level of pulses[${i - 1}]`).not.toBe(
        pulses[i - 1]!.level,
      );
    }
  });
});
