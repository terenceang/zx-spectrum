import { describe, expect, it } from "vitest";
import { paletteIndex } from "../ula/palette.js";
import { Machine48k } from "./machine48k.js";

describe("Machine48k", () => {
  it("renders a frame from display RAM and reflects border changes", () => {
    const machine = new Machine48k();
    // No ROM loaded: PC=0 reads as 0x00 (NOP) throughout the 16K ROM window, so the
    // CPU harmlessly spins for the frame without touching RAM — enough to exercise
    // runFrame()/ULA rendering against RAM we set up directly, without needing a
    // real boot ROM.
    machine.reset();

    // First pixel byte of the display (row 0, column byte 0): all 8 pixels set.
    machine.memory.poke8(0x4000, 0xff);
    // Attribute for that cell: ink=1 (blue), paper=7 (white), no bright/flash.
    machine.memory.poke8(0x5800, 0x39);
    machine.ula.setBorder(2); // red

    machine.runFrame();

    const { pixels, width } = machine.getFrameBuffer();
    const borderCols = 32; // 4 character cells either side, per ULA_48K_PROFILE
    const topBorderRows = 48;

    // A border pixel, well away from the display area.
    expect(pixels[5 * width + 5]).toBe(paletteIndex(2, false));

    // The first 8 pixels of the top display row should be "ink" (blue).
    const displayRowBase = topBorderRows * width + borderCols;
    for (let x = 0; x < 8; x++) {
      expect(pixels[displayRowBase + x]).toBe(paletteIndex(1, false));
    }
    // Pixel 8 starts the *next* 8x8 attribute cell (xByte=1), whose pixel and
    // attribute bytes we never set — both default to 0, i.e. black paper.
    expect(pixels[displayRowBase + 8]).toBe(paletteIndex(0, false));
  });

  it("keyboard state affects port 0xFE reads through the ULA", () => {
    const machine = new Machine48k();
    machine.reset();
    machine.keyboard.setKey(0, 0, true); // CAPS SHIFT (row 0, bit 0) held down

    const value = machine.ula.readPort(0xfe); // selects row 0 (bit0 of high byte = 0)
    expect(value & 0x01).toBe(0); // active-low: bit clear means held
  });

  it("renders beam-accurate border stripes from mid-frame port 0xFE writes", () => {
    const machine = new Machine48k();
    machine.reset();

    // Start with border color 1 (blue)
    machine.ula.setBorder(1);

    // Frame setup: row y=20 (top border) starts at lineStartT(20):
    // lineStartT(20) = 14335 - 48*224 - 16 + 20*224 = 3567 + 4480 = 8047
    // Let's write border color 6 (yellow) at T = 8047 + 50 = 8097 (pixel x = 100 on row 20)
    // Run a frame where CPU executes OUT (0xFE), A at specific T-states
    // To simulate CPU writes during runFrame(), we can run frame and intercept or poke opcode
    // Or set up code at ROM address 0x0000 to do OUT (0xFE), A
    // Opcode at 0x0000: LD A, 6 (3E 06 - 7 T), OUT (FE), A (D3 FE - 11 T), then HALT / NOPs
    // Or write directly via ula.writePort at tStates during frame
    machine.ula.beginFrame();
    machine.ula.writePort(8047 + 50, 6); // yellow at pixel 100 on row 20
    machine.ula.writePort(8047 + 100, 2); // red at pixel 200 on row 20

    const { pixels, width } = machine.getFrameBuffer();
    const row20Base = 20 * width;

    // Pixels 0..99 on row 20 should be blue (1)
    expect(pixels[row20Base + 50]).toBe(paletteIndex(1, false));
    expect(pixels[row20Base + 99]).toBe(paletteIndex(1, false));

    // Pixels 100..199 on row 20 should be yellow (6)
    expect(pixels[row20Base + 100]).toBe(paletteIndex(6, false));
    expect(pixels[row20Base + 150]).toBe(paletteIndex(6, false));
    expect(pixels[row20Base + 199]).toBe(paletteIndex(6, false));

    // Pixels 200..319 on row 20 should be red (2)
    expect(pixels[row20Base + 200]).toBe(paletteIndex(2, false));
    expect(pixels[row20Base + 319]).toBe(paletteIndex(2, false));
  });

  it("preserves border changes across runFrame() into getFrameBuffer()", () => {
    const machine = new Machine48k();
    const rom = new Uint8Array(16384);
    // LD A, 5 (cyan); OUT (0xFE), A; HALT
    rom[0] = 0x3e;
    rom[1] = 0x05;
    rom[2] = 0xd3;
    rom[3] = 0xfe;
    rom[4] = 0x76;
    machine.loadRom(rom);
    machine.reset();

    machine.runFrame();

    const { pixels, width, height } = machine.getFrameBuffer();
    // After OUT (0xFE), A executed near start of frame, bottom border should be cyan (5)
    const bottomRow = (height - 5) * width;
    expect(pixels[bottomRow + 10]).toBe(paletteIndex(5, false));
  });
});

