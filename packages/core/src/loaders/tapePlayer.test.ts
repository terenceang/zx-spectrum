import { describe, expect, it } from "vitest";
import { TapeEdgePlayer } from "./tapePlayer.js";
import type { TapePulseSequence } from "./tapePulse.js";

describe("TapeEdgePlayer", () => {
  const pulses: TapePulseSequence = [
    { level: 1, duration: 100 },
    { level: 0, duration: 200 },
    { level: 1, duration: 50 },
  ];

  it("holds level 0 when nothing is loaded or not started", () => {
    const player = new TapeEdgePlayer();
    expect(player.levelAt(0)).toBe(0);
    player.load(pulses);
    expect(player.levelAt(0)).toBe(0);
  });

  it("advances through pulses as the absolute T-state clock advances", () => {
    const player = new TapeEdgePlayer();
    player.load(pulses);
    player.start(1000);

    expect(player.levelAt(1000)).toBe(1);
    expect(player.levelAt(1099)).toBe(1);
    expect(player.levelAt(1100)).toBe(0);
    expect(player.levelAt(1299)).toBe(0);
    expect(player.levelAt(1300)).toBe(1);
    expect(player.levelAt(1349)).toBe(1);
    expect(player.isPlaying()).toBe(true);
    expect(player.levelAt(1350)).toBe(0);
    expect(player.isPlaying()).toBe(false);
  });

  it("stop() halts playback immediately", () => {
    const player = new TapeEdgePlayer();
    player.load(pulses);
    player.start(0);
    expect(player.levelAt(50)).toBe(1);
    player.stop();
    expect(player.levelAt(50)).toBe(0);
    expect(player.isPlaying()).toBe(false);
  });

  it("renders frame audio samples for tape loading screech tones", () => {
    const player = new TapeEdgePlayer();
    player.load(pulses);
    player.start(0);

    const samples = player.renderFrameAudio(0, 350, 7);
    expect(samples.length).toBe(7);
    expect(samples[0]).toBeGreaterThan(0.5);
    expect(samples[3]).toBeLessThan(0.1);
  });

  it("holds at a pause pulse until CPU actively polls in a loading loop", () => {
    const player = new TapeEdgePlayer();
    const multiBlock: TapePulseSequence = [
      { level: 1, duration: 1000 },
      { level: 0, duration: 2000, pause: true },
      { level: 1, duration: 500 },
    ];
    player.load(multiBlock);
    player.start(0);

    expect(player.levelAt(100)).toBe(1);
    expect(player.levelAt(1050)).toBe(0);

    expect(player.levelAt(50000)).toBe(0);

    expect(player.levelAt(100000)).toBe(0);
    expect(player.levelAt(100050)).toBe(1);
    expect(player.levelAt(100400)).toBe(1);
  });

  it("tracks and advances blocks for instant tape loading", () => {
    const player = new TapeEdgePlayer();
    const seq: TapePulseSequence = [
      { level: 1, duration: 100 },
      { level: 0, duration: 200 },
      { level: 1, duration: 300 },
      { level: 0, duration: 400 },
    ];
    Object.defineProperty(seq, "blocks", {
      value: [
        { data: Uint8Array.from([0x00, 0x01]), pulseStartIndex: 0, pulseEndIndex: 2 },
        { data: Uint8Array.from([0xff, 0x02]), pulseStartIndex: 2, pulseEndIndex: 4 },
      ],
    });

    player.load(seq);
    player.start(0);

    expect(player.hasBlocks()).toBe(true);
    expect(player.getNextBlock()?.data).toEqual(Uint8Array.from([0x00, 0x01]));

    player.advanceBlock(1000);
    expect(player.hasBlocks()).toBe(true);
    expect(player.getNextBlock()?.data).toEqual(Uint8Array.from([0xff, 0x02]));

    player.advanceBlock(2000);
    expect(player.hasBlocks()).toBe(false);
    expect(player.getNextBlock()).toBeNull();
    expect(player.isPlaying()).toBe(false);
  });
});
