import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MachinePlus3 } from "./machinePlus3.js";

const ROM_DIR = resolve(__dirname, "../../../../rom");

function tryLoadPlus3Roms(): [Uint8Array, Uint8Array, Uint8Array, Uint8Array] | null {
  try {
    const rom0 = new Uint8Array(readFileSync(resolve(ROM_DIR, "zcen3e0.rom")));
    const rom1 = new Uint8Array(readFileSync(resolve(ROM_DIR, "zcen3e1.rom")));
    const rom2 = new Uint8Array(readFileSync(resolve(ROM_DIR, "zcen3e2.rom")));
    const rom3 = new Uint8Array(readFileSync(resolve(ROM_DIR, "zcen3e3.rom")));
    return [rom0, rom1, rom2, rom3];
  } catch {
    return null;
  }
}

describe("MachinePlus3", () => {
  it("boots with real +3 ROMs without crashing or spinning at reset", () => {
    const roms = tryLoadPlus3Roms();
    if (!roms) {
      console.warn("Skipping MachinePlus3 boot test: rom/zcen3e*.rom not found");
      return;
    }

    const machine = new MachinePlus3();
    machine.loadRoms(roms[0], roms[1], roms[2], roms[3]);
    machine.reset();

    for (let frame = 0; frame < 120; frame++) {
      machine.runFrame();
    }

    expect(machine.cpu.regs.pc).toBeGreaterThan(0);

    const fb = machine.getFrameBuffer();
    expect(fb.width).toBeGreaterThan(256);
    expect(fb.height).toBeGreaterThan(192);
    expect(fb.pixels.length).toBe(fb.width * fb.height);
  });

  it("dispatches port reads and writes for AY, paging, and FDC", () => {
    const machine = new MachinePlus3();
    machine.reset();

    machine.writePort(0x1ffd, 0x08);
    expect(machine.memory.diskMotorOn).toBe(true);
    expect(machine.fdc.isMotorOn).toBe(true);

    const msr = machine.readPort(0x2ffd);
    expect(msr & 0x80).toBe(0x80);

    machine.writePort(0xfffd, 0x06);
    machine.writePort(0xbffd, 0x0f);
    expect(machine.readPort(0xfffd)).toBe(0x0f);
  });
});
