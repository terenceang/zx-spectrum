import { describe, expect, it } from "vitest";
import { Beeper } from "./beeper.js";

describe("Beeper", () => {
  it("renders silence when no edges occur", () => {
    const beeper = new Beeper();
    const samples = beeper.renderFrame(69888, 882);
    expect(samples.length).toBe(882);
    for (const s of samples) {
      expect(s).toBe(0);
    }
  });

  it("renders pulse from recorded edges at the expected sample positions", () => {
    const beeper = new Beeper();
    const frameTStates = 69888;
    const sampleCount = 882;
    const tStatesPerSample = frameTStates / sampleCount;

    // Toggle high at sample 100, toggle low at sample 200
    beeper.setLevel(100 * tStatesPerSample, 1);
    beeper.setLevel(200 * tStatesPerSample, 0);

    const samples = beeper.renderFrame(frameTStates, sampleCount);

    // Before sample 100: silence (0)
    expect(samples[50]).toBe(0);
    expect(samples[99]).toBe(0);

    // Between sample 100 and 199: high (> 0.5)
    expect(samples[100]).toBeGreaterThan(0.9);
    expect(samples[150]).toBeGreaterThan(0.5);
    expect(samples[199]).toBeGreaterThan(0.5);

    // After sample 200: transitions low and decays towards 0
    expect(samples[200]).toBeLessThan(0);
    expect(Math.abs(samples[500])).toBeLessThan(0.1);
    expect(Math.abs(samples[800])).toBeLessThan(0.05);
  });

  it("carries level across frame boundaries", () => {
    const beeper = new Beeper();
    const frameTStates = 69888;
    const sampleCount = 882;

    // Set high near end of frame 1
    beeper.setLevel(60000, 1);
    const frame1 = beeper.renderFrame(frameTStates, sampleCount);
    expect(frame1[sampleCount - 1]).toBeGreaterThan(0.5);

    // Frame 2 has no new writes: level carries over and decays gracefully
    const frame2 = beeper.renderFrame(frameTStates, sampleCount);
    expect(frame2[0]).toBeGreaterThan(0.5);
  });
});
