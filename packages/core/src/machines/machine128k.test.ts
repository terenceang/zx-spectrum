import { beforeEach, describe, expect, it } from "vitest";
import { paletteIndex } from "../ula/palette.js";
import { Machine128k } from "./machine128k.js";

describe("Machine128k", () => {
  let machine: Machine128k;
  beforeEach(() => {
    machine = new Machine128k();
    machine.reset();
  });

  it("pages RAM banks via port 0x7FFD and reads/writes the paged-in bank", () => {
    machine.writePort(0x7ffd, 3);
    machine.memory.write8(0xc000, 0xaa);
    machine.writePort(0x7ffd, 4);
    machine.memory.write8(0xc000, 0xbb);

    machine.writePort(0x7ffd, 3);
    expect(machine.memory.read8(0xc000)).toBe(0xaa);
    machine.writePort(0x7ffd, 4);
    expect(machine.memory.read8(0xc000)).toBe(0xbb);
  });

  it("contends odd RAM banks regardless of which slot they're paged into", () => {
    machine.writePort(0x7ffd, 3);
    expect(machine.memory.isContended(0xc000)).toBe(true);
    machine.writePort(0x7ffd, 4);
    expect(machine.memory.isContended(0xc000)).toBe(false);

    expect(machine.memory.isContended(0x4000)).toBe(true);
    expect(machine.memory.isContended(0x8000)).toBe(false);
  });

  it("switches the rendered screen between bank 5 and bank 7 via port 0x7FFD bit 3", () => {
    machine.memory.pokeBank(
      5,
      (() => {
        const b = new Uint8Array(0x4000);
        b[0] = 0xff;
        return b;
      })(),
    );
    machine.memory.pokeBank(7, new Uint8Array(0x4000));

    machine.ula.setBorder(0);
    let frame = machine.getFrameBuffer();
    const borderCols = 32;
    const topBorderRows = 48;
    const rowBase = topBorderRows * frame.width + borderCols;
    expect(frame.pixels[rowBase]).toBe(paletteIndex(0, false));

    machine.writePort(0x7ffd, 0x08);
    frame = machine.getFrameBuffer();
    expect(frame.pixels[rowBase]).toBe(paletteIndex(0, false));
  });

  it("locks paging once bit 5 of the paging register is set, until reset", () => {
    machine.writePort(0x7ffd, 0x20);
    machine.writePort(0x7ffd, 3);
    expect(machine.memory.read8(0xc000)).toBe(machine.memory.peek8(0xc000));
    machine.memory.pokeBank(
      0,
      (() => {
        const b = new Uint8Array(0x4000);
        b[0] = 0x42;
        return b;
      })(),
    );
    expect(machine.memory.read8(0xc000)).toBe(0x42);

    machine.reset();
    machine.writePort(0x7ffd, 3);
    machine.memory.write8(0xc000, 0x99);
    expect(machine.memory.read8(0xc000)).toBe(0x99);
  });

  it("applies a 48K snapshot into 128K machine mapping (banks 5, 2, 0)", async () => {
    const { applySnapshotTo128k } = await import("../loaders/apply.js");
    const ram = new Uint8Array(49152);
    ram[0] = 0x55;
    ram[0x4000] = 0x22;
    ram[0x8000] = 0x00;

    applySnapshotTo128k(machine, {
      model: "48k",
      cpu: machine.cpu.getState(),
      border: 1,
      ram,
    });

    expect(machine.memory.read8(0x4000)).toBe(0x55);
    expect(machine.memory.read8(0x8000)).toBe(0x22);
    expect(machine.memory.read8(0xc000)).toBe(0x00);
  });
});
