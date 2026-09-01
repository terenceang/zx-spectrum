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
});
