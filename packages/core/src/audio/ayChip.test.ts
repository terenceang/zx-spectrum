import { describe, expect, it } from "vitest";
import { AY_CLOCK_HZ, AyChip } from "./ayChip.js";

function writeReg(chip: AyChip, reg: number, value: number): void {
  chip.selectRegister(reg);
  chip.writeData(value);
}

describe("AyChip", () => {
  it("register select/write/read round-trips", () => {
    const chip = new AyChip();
    writeReg(chip, 8, 0x0f);
    chip.selectRegister(8);
    expect(chip.readData()).toBe(0x0f);
  });

  it("produces a channel-A square wave at the expected tone frequency", () => {
    const chip = new AyChip();
    const period = 100; // R0/R1: tone period 100 -> freq = AY_CLOCK_HZ / (16 * 100)
    writeReg(chip, 0, period & 0xff);
    writeReg(chip, 1, (period >> 8) & 0x0f);
    writeReg(chip, 7, 0b111110); // enable only channel A tone, everything else off
    writeReg(chip, 8, 0x0f); // full volume, no envelope

    const sampleRate = 44100;
    const sampleCount = sampleRate; // 1 second
    const samples = chip.renderFrame(sampleCount, sampleRate);

    let crossings = 0;
    for (let i = 1; i < samples.length; i++) {
      if ((samples[i - 1]! <= 0) !== (samples[i]! <= 0)) crossings++;
    }
    const expectedFreq = AY_CLOCK_HZ / (16 * period);
    const measuredFreq = crossings / 2; // two zero-crossings per cycle

    expect(measuredFreq).toBeGreaterThan(expectedFreq * 0.95);
    expect(measuredFreq).toBeLessThan(expectedFreq * 1.05);
  });

  it("silent channel (volume 0) contributes nothing", () => {
    const chip = new AyChip();
    writeReg(chip, 0, 50);
    writeReg(chip, 1, 0);
    writeReg(chip, 7, 0b111110);
    writeReg(chip, 8, 0); // volume 0

    const samples = chip.renderFrame(1000, 44100);
    for (const s of samples) expect(s).toBe(0);
  });

  it("renders stereo audio with correct channel separation in ACB mode", () => {
    const chip = new AyChip();
    // Enable only Channel A (Tone period 100)
    writeReg(chip, 0, 100);
    writeReg(chip, 1, 0);
    writeReg(chip, 7, 0b111110); // Channel A only
    writeReg(chip, 8, 0x0f); // Channel A full vol
    writeReg(chip, 9, 0x00); // Channel B off
    writeReg(chip, 10, 0x00); // Channel C off

    const { left, right } = chip.renderFrameStereo(500, 44100, "acb");
    // In ACB, Channel A is 100% Left, 0% Right
    let maxLeft = 0;
    let maxRight = 0;
    for (let i = 0; i < 500; i++) {
      maxLeft = Math.max(maxLeft, Math.abs(left[i]!));
      maxRight = Math.max(maxRight, Math.abs(right[i]!));
    }
    expect(maxLeft).toBeGreaterThan(0.4);
    expect(maxRight).toBe(0);
  });

  it("envelope with CONT=0 decays and holds at level 0", () => {
    const chip = new AyChip();
    writeReg(chip, 0, 1);
    writeReg(chip, 1, 0);
    writeReg(chip, 7, 0b111110); // channel A tone only
    writeReg(chip, 8, 0x10); // use envelope
    writeReg(chip, 11, 1); // short envelope period so it completes quickly
    writeReg(chip, 12, 0);
    writeReg(chip, 13, 0b0000); // CONT=0, decay shape

    // Run enough samples for the envelope (16 steps * period*8 AY cycles) to finish.
    chip.renderFrame(44100, 44100);
    const tail = chip.renderFrame(1000, 44100);
    // Holding at level 0 means every sample is exactly 0 (silence).
    for (const s of tail) expect(s).toBe(0);
  });
});
