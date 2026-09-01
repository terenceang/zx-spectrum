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
});
