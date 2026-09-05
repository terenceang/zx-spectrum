import { describe, expect, it } from "vitest";
import type { TapePulseSequence } from "../loaders/tapePulse.js";
import { paletteIndex } from "../ula/palette.js";
import { Machine48k } from "./machine48k.js";

describe("Machine48k", () => {
  it("renders a frame from display RAM and reflects border changes", () => {
    const machine = new Machine48k();
    machine.reset();

    machine.memory.poke8(0x4000, 0xff);
    machine.memory.poke8(0x5800, 0x39);
    machine.ula.setBorder(2);

    machine.runFrame();

    const { pixels, width } = machine.getFrameBuffer();
    const borderCols = 32;
    const topBorderRows = 48;

    expect(pixels[5 * width + 5]).toBe(paletteIndex(2, false));

    const displayRowBase = topBorderRows * width + borderCols;
    for (let x = 0; x < 8; x++) {
      expect(pixels[displayRowBase + x]).toBe(paletteIndex(1, false));
    }
    expect(pixels[displayRowBase + 8]).toBe(paletteIndex(0, false));
  });

  it("keyboard state affects port 0xFE reads through the ULA", () => {
    const machine = new Machine48k();
    machine.reset();
    machine.keyboard.setKey(0, 0, true);

    const value = machine.ula.readPort(0xfe);
    expect(value & 0x01).toBe(0);
  });

  it("renders beam-accurate border stripes from mid-frame port 0xFE writes", () => {
    const machine = new Machine48k();
    machine.reset();

    machine.ula.setBorder(1);

    machine.ula.beginFrame();
    machine.ula.writePort(8047 + 50, 6);
    machine.ula.writePort(8047 + 100, 2);

    const { pixels, width } = machine.getFrameBuffer();
    const row20Base = 20 * width;

    expect(pixels[row20Base + 50]).toBe(paletteIndex(1, false));
    expect(pixels[row20Base + 99]).toBe(paletteIndex(1, false));

    expect(pixels[row20Base + 100]).toBe(paletteIndex(6, false));
    expect(pixels[row20Base + 150]).toBe(paletteIndex(6, false));
    expect(pixels[row20Base + 199]).toBe(paletteIndex(6, false));

    expect(pixels[row20Base + 200]).toBe(paletteIndex(2, false));
    expect(pixels[row20Base + 319]).toBe(paletteIndex(2, false));
  });

  it("preserves border changes across runFrame() into getFrameBuffer()", () => {
    const machine = new Machine48k();
    const rom = new Uint8Array(16384);
    rom[0] = 0x3e;
    rom[1] = 0x05;
    rom[2] = 0xd3;
    rom[3] = 0xfe;
    rom[4] = 0x76;
    machine.loadRom(rom);
    machine.reset();

    machine.runFrame();

    const { pixels, width, height } = machine.getFrameBuffer();
    const bottomRow = (height - 5) * width;
    expect(pixels[bottomRow + 10]).toBe(paletteIndex(5, false));
  });

  it("silences tape loading tones when fastTapeLoad is enabled, regardless of tapeSoundEnabled", () => {
    const machine = new Machine48k();
    machine.reset();

    const pulses: TapePulseSequence = [
      { level: 1, duration: 50000 },
      { level: 0, duration: 20000 },
    ];
    machine.loadTape(pulses);
    machine.tapeSoundEnabled = true;
    machine.playTape();

    machine.fastTapeLoad = false;
    const normalSamples = machine.getAudioSamples(50, 44100);
    expect(Array.from(normalSamples).some((s) => Math.abs(s) > 0.01)).toBe(true);

    machine.fastTapeLoad = true;
    const fastLoadSamples = machine.getAudioSamples(50, 44100);
    for (const s of fastLoadSamples) {
      expect(s).toBe(0);
    }
  });
});
