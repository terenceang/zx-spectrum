import { describe, expect, it } from "vitest";
import { paletteIndex } from "../ula/palette.js";
import { Machine128k } from "./machine128k.js";

describe("Machine128k", () => {
  it("pages RAM banks via port 0x7FFD and reads/writes the paged-in bank", () => {
    const machine = new Machine128k();
    machine.reset();

    machine.writePort(0x7ffd, 3); // page RAM bank 3 in at 0xC000
    machine.memory.write8(0xc000, 0xaa);
    machine.writePort(0x7ffd, 4); // switch to bank 4
    machine.memory.write8(0xc000, 0xbb);

    machine.writePort(0x7ffd, 3);
    expect(machine.memory.read8(0xc000)).toBe(0xaa); // bank 3's own data preserved
    machine.writePort(0x7ffd, 4);
    expect(machine.memory.read8(0xc000)).toBe(0xbb);
  });

  it("contends odd RAM banks regardless of which slot they're paged into", () => {
    const machine = new Machine128k();
    machine.reset();

    machine.writePort(0x7ffd, 3); // bank 3 (odd) paged at 0xC000 -> contended
    expect(machine.memory.isContended(0xc000)).toBe(true);
    machine.writePort(0x7ffd, 4); // bank 4 (even) paged at 0xC000 -> not contended
    expect(machine.memory.isContended(0xc000)).toBe(false);

    // Bank 5 (fixed at 0x4000) and bank 2 (fixed at 0x8000) are always mapped there.
    expect(machine.memory.isContended(0x4000)).toBe(true); // bank 5, odd
    expect(machine.memory.isContended(0x8000)).toBe(false); // bank 2, even
  });

  it("switches the rendered screen between bank 5 and bank 7 via port 0x7FFD bit 3", () => {
    const machine = new Machine128k();
    machine.reset();

    machine.memory.pokeBank(5, (() => {
      const b = new Uint8Array(0x4000);
      b[0] = 0xff; // first pixel byte: all set
      return b;
    })());
    machine.memory.pokeBank(7, new Uint8Array(0x4000)); // all zero

    machine.ula.setBorder(0);
    let frame = machine.getFrameBuffer();
    const borderCols = 32;
    const topBorderRows = 48;
    const rowBase = topBorderRows * frame.width + borderCols;
    expect(frame.pixels[rowBase]).toBe(paletteIndex(0, false)); // attr byte 0 -> ink 0

    machine.writePort(0x7ffd, 0x08); // select screen bank 7 (all zero pixels)
    frame = machine.getFrameBuffer();
    expect(frame.pixels[rowBase]).toBe(paletteIndex(0, false));
  });

  it("locks paging once bit 5 of the paging register is set, until reset", () => {
    const machine = new Machine128k();
    machine.reset();

    machine.writePort(0x7ffd, 0x20); // bank 0, lock paging
    machine.writePort(0x7ffd, 3); // attempted change is ignored
    expect(machine.memory.read8(0xc000)).toBe(machine.memory.peek8(0xc000)); // still bank 0
    machine.memory.pokeBank(0, (() => {
      const b = new Uint8Array(0x4000);
      b[0] = 0x42;
      return b;
    })());
    expect(machine.memory.read8(0xc000)).toBe(0x42);

    machine.reset();
    machine.writePort(0x7ffd, 3);
    machine.memory.write8(0xc000, 0x99);
    expect(machine.memory.read8(0xc000)).toBe(0x99); // paging works again post-reset
  });

  it("applies a 48K snapshot into 128K machine mapping (banks 5, 2, 0)", async () => {
    const { applySnapshotTo128k } = await import("../loaders/apply.js");
    const machine = new Machine128k();
    const ram = new Uint8Array(49152);
    ram[0] = 0x55; // start of bank 5
    ram[0x4000] = 0x22; // start of bank 2
    ram[0x8000] = 0x00; // start of bank 0

    applySnapshotTo128k(machine, {
      model: "48k",
      cpu: machine.cpu.getState(),
      border: 1,
      ram,
    });

    // Default 128K map (port 7FFD=0): bank 5 at 0x4000, bank 2 at 0x8000, bank 0 at 0xC000
    expect(machine.memory.read8(0x4000)).toBe(0x55);
    expect(machine.memory.read8(0x8000)).toBe(0x22);
    expect(machine.memory.read8(0xc000)).toBe(0x00);
  });
});
