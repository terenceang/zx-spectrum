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
    expect(player.levelAt(0)).toBe(0); // loaded but not started
  });

  it("advances through pulses as the absolute T-state clock advances", () => {
    const player = new TapeEdgePlayer();
    player.load(pulses);
    player.start(1000); // arbitrary non-zero start time

    expect(player.levelAt(1000)).toBe(1);
    expect(player.levelAt(1099)).toBe(1); // still within the first 100T pulse
    expect(player.levelAt(1100)).toBe(0); // second pulse starts
    expect(player.levelAt(1299)).toBe(0);
    expect(player.levelAt(1300)).toBe(1); // third pulse
    expect(player.levelAt(1349)).toBe(1);
    expect(player.isPlaying()).toBe(true);
    expect(player.levelAt(1350)).toBe(0); // ran off the end
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
    // Samples during the first pulse (level 1) should be positive
    expect(samples[0]).toBeGreaterThan(0.5);
    // Samples during the second pulse (level 0) should transition negative
    expect(samples[3]).toBeLessThan(0.1);
  });

  it("holds at a pause pulse until CPU actively polls in a loading loop", () => {
    const player = new TapeEdgePlayer();
    const multiBlock: TapePulseSequence = [
      { level: 1, duration: 1000 },
      { level: 0, duration: 2000, pause: true },
      { level: 1, duration: 500 }, // Next block pilot pulse
    ];
    player.load(multiBlock);
    player.start(0);

    // Reading first block:
    expect(player.levelAt(100)).toBe(1);
    expect(player.levelAt(1050)).toBe(0); // in pause

    // Suppose CPU goes idle (e.g. decompression takes 100,000 T-states without reading tape):
    // Sporadic read during decompression (e.g. keyboard interrupt):
    expect(player.levelAt(50000)).toBe(0); // Still holds pause, dt >> 500

    // After 100,000 T-states, CPU finally enters loading loop (tight polling, dt < 500):
    expect(player.levelAt(100000)).toBe(0); // first read of loop (consecutiveReads = 1)
    // Second read in tight loop (consecutiveReads = 2):
    expect(player.levelAt(100050)).toBe(1); // Next block starts fresh, no pilot pulses missed!
    expect(player.levelAt(100400)).toBe(1); // still within the 500T pulse of next block
  });
});
