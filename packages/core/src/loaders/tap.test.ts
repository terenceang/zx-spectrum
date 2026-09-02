import { describe, expect, it } from "vitest";
import { BIT0_PULSE, BIT1_PULSE, HEADER_PILOT_COUNT, PILOT_PULSE, SYNC1_PULSE, SYNC2_PULSE } from "./tapePulse.js";
import { parseTap } from "./tap.js";

describe("parseTap", () => {
  it("encodes a header block's pilot tone, sync, and data bits", () => {
    // flag=0x00 (header block) -> long pilot; two data bytes: 0x00, 0xFF.
    const block = Uint8Array.from([0x00, 0xff]);
    const bytes = new Uint8Array(2 + block.length);
    bytes[0] = block.length & 0xff;
    bytes[1] = (block.length >> 8) & 0xff;
    bytes.set(block, 2);

    const pulses = parseTap(bytes);

    expect(pulses.length).toBe(HEADER_PILOT_COUNT + 2 + 2 * 8 * 2 + 1); // pilot+sync+bits+pause
    for (let i = 0; i < HEADER_PILOT_COUNT; i++) {
      expect(pulses[i]!.duration).toBe(PILOT_PULSE);
    }
    expect(pulses[HEADER_PILOT_COUNT]!.duration).toBe(SYNC1_PULSE);
    expect(pulses[HEADER_PILOT_COUNT + 1]!.duration).toBe(SYNC2_PULSE);

    // First data byte is 0x00 -> 8 bits of BIT0_PULSE (2 pulses each).
    const firstBitPulse = HEADER_PILOT_COUNT + 2;
    for (let i = 0; i < 16; i++) {
      expect(pulses[firstBitPulse + i]!.duration).toBe(BIT0_PULSE);
    }
    // Second data byte is 0xFF -> 8 bits of BIT1_PULSE.
    const secondBitPulse = firstBitPulse + 16;
    for (let i = 0; i < 16; i++) {
      expect(pulses[secondBitPulse + i]!.duration).toBe(BIT1_PULSE);
    }

    // Trailing pause, held at level 0.
    expect(pulses.at(-1)!.level).toBe(0);
  });

  it("returns an empty sequence for an empty file", () => {
    expect(parseTap(new Uint8Array(0))).toEqual([]);
  });

  it("keeps every pulse a real edge across a multi-block pause boundary", () => {
    // Two blocks back-to-back: the pause after block 1 must not merge into block
    // 2's first pilot pulse (both at level 0 would silently drop the pilot tone's
    // first transition) — this is exactly the bug that broke every block after the
    // first in real multi-block .tap files while single-block files looked fine.
    function block(data: number[]): number[] {
      const bytes = Uint8Array.from(data);
      return [bytes.length & 0xff, (bytes.length >> 8) & 0xff, ...bytes];
    }
    const bytes = Uint8Array.from([...block([0x00, 0x01]), ...block([0xff, 0x02])]);

    const pulses = parseTap(bytes);
    for (let i = 1; i < pulses.length; i++) {
      expect(pulses[i]!.level, `pulses[${i}] repeats the level of pulses[${i - 1}]`).not.toBe(
        pulses[i - 1]!.level,
      );
    }
  });

  it("attaches tape blocks with data and pulse range boundaries", () => {
    function block(data: number[]): number[] {
      const bytes = Uint8Array.from(data);
      return [bytes.length & 0xff, (bytes.length >> 8) & 0xff, ...bytes];
    }
    const bytes = Uint8Array.from([...block([0x00, 0x10, 0x20]), ...block([0xff, 0x30, 0x40])]);
    const pulses = parseTap(bytes);
    expect(pulses.blocks).toBeDefined();
    expect(pulses.blocks?.length).toBe(2);
    expect(pulses.blocks![0]!.data).toEqual(Uint8Array.from([0x00, 0x10, 0x20]));
    expect(pulses.blocks![0]!.pulseStartIndex).toBe(0);
    expect(pulses.blocks![0]!.pulseEndIndex).toBeGreaterThan(0);
    expect(pulses.blocks![1]!.pulseStartIndex).toBe(pulses.blocks![0]!.pulseEndIndex);
    expect(pulses.blocks![1]!.pulseEndIndex).toBe(pulses.length);
  });
});
