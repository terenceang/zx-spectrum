import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Flag } from "../cpu/flags.js";
import { RegIndex } from "../cpu/registers.js";
import { parseTap } from "../loaders/tap.js";
import { Machine128k } from "./machine128k.js";
import { Machine48k } from "./machine48k.js";

function buildTapBlock(flag: number, payload: number[]): Uint8Array {
  let checksum = flag;
  for (const b of payload) checksum ^= b;
  const blockLength = 1 + payload.length + 1;
  const bytes = new Uint8Array(2 + blockLength);
  bytes[0] = blockLength & 0xff;
  bytes[1] = (blockLength >> 8) & 0xff;
  bytes[2] = flag;
  bytes.set(payload, 3);
  bytes[2 + blockLength - 1] = checksum;
  return bytes;
}

function load48kRom(machine: Machine48k): void {
  try {
    const romPath = resolve(process.cwd(), "rom/48.rom");
    machine.loadRom(readFileSync(romPath));
  } catch {
    const syntheticRom = new Uint8Array(16384);
    syntheticRom[0x053f] = 0xf5;
    syntheticRom[0x0540] = 0xfb;
    syntheticRom[0x0541] = 0xf1;
    syntheticRom[0x0542] = 0xc9;
    syntheticRom[0x0556] = 0x14;
    syntheticRom[0x0557] = 0xc9;
    machine.loadRom(syntheticRom);
  }
}

function runUntilPc(machine: Machine48k | Machine128k, targetPc: number, maxSteps = 100): void {
  for (let i = 0; i < maxSteps; i++) {
    if (machine.cpu.regs.pc === targetPc) return;
    machine.step();
  }
  expect(machine.cpu.regs.pc).toBe(targetPc);
}

function typeKeyOnMachine(
  machine: Machine48k | Machine128k,
  row: number,
  bit: number,
  sRow?: number,
  sBit?: number,
): void {
  if (sRow !== undefined && sBit !== undefined) machine.keyboard.setKey(sRow, sBit, true);
  machine.keyboard.setKey(row, bit, true);
  for (let f = 0; f < 6; f++) machine.runFrame();
  machine.keyboard.setKey(row, bit, false);
  if (sRow !== undefined && sBit !== undefined) machine.keyboard.setKey(sRow, sBit, false);
  for (let f = 0; f < 6; f++) machine.runFrame();
}

describe("Fast tape instant load option", () => {
  it("instantly loads header and data blocks into memory when fastTapeLoad is true", () => {
    const machine = new Machine48k();
    load48kRom(machine);
    machine.reset();

    const headerPayload = [0x00, ...new Array(16).fill(0x42)];
    const dataPayload = [10, 20, 30, 40, 50, 60, 70, 80];

    const tapFile = new Uint8Array([
      ...buildTapBlock(0x00, headerPayload),
      ...buildTapBlock(0xff, dataPayload),
    ]);

    machine.loadTape(parseTap(tapFile));
    machine.fastTapeLoad = true;
    machine.playTape();

    expect(machine.tape.isPlaying()).toBe(true);
    expect(machine.tape.hasBlocks()).toBe(true);

    machine.cpu.regs.pc = 0x0556;
    machine.cpu.regs.ix = 0x5c74;
    machine.cpu.regs.de = headerPayload.length;
    machine.cpu.regs.bytes[RegIndex.A] = 0x00;
    machine.cpu.setFlag(Flag.C, true);
    machine.cpu.push(0x1234);

    runUntilPc(machine, 0x1234);

    expect(machine.cpu.regs.pc).toBe(0x1234);
    expect(machine.cpu.getFlag(Flag.C)).toBe(true);
    expect(machine.cpu.regs.de).toBe(0);
    expect(machine.cpu.regs.ix).toBe(0x5c74 + headerPayload.length);

    for (let i = 0; i < headerPayload.length; i++) {
      expect(machine.memory.read8(0x5c74 + i)).toBe(headerPayload[i]);
    }

    machine.cpu.regs.pc = 0x0556;
    machine.cpu.regs.ix = 0x8000;
    machine.cpu.regs.de = dataPayload.length;
    machine.cpu.regs.bytes[RegIndex.A] = 0xff;
    machine.cpu.setFlag(Flag.C, true);
    machine.cpu.push(0x5678);

    runUntilPc(machine, 0x5678);

    expect(machine.cpu.regs.pc).toBe(0x5678);
    expect(machine.cpu.getFlag(Flag.C)).toBe(true);
    expect(machine.cpu.regs.de).toBe(0);
    expect(machine.cpu.regs.ix).toBe(0x8000 + dataPayload.length);

    for (let i = 0; i < dataPayload.length; i++) {
      expect(machine.memory.read8(0x8000 + i)).toBe(dataPayload[i]);
    }

    expect(machine.tape.hasBlocks()).toBe(false);
    expect(machine.tape.isPlaying()).toBe(false);
  });

  it("does not intercept 0x0556 when fastTapeLoad is false", () => {
    const machine = new Machine48k();
    load48kRom(machine);
    machine.reset();

    const tapFile = buildTapBlock(0x00, [1, 2, 3]);
    machine.loadTape(parseTap(tapFile));
    machine.fastTapeLoad = false;
    machine.playTape();

    machine.cpu.regs.pc = 0x0556;
    machine.cpu.regs.bytes[RegIndex.D] = 5;

    machine.step();
    expect(machine.cpu.regs.pc).toBe(0x0557);
    expect(machine.cpu.regs.bytes[RegIndex.D]).toBe(6);
  });

  it("handles VERIFY mode: success on match, failure on mismatch", () => {
    const machine = new Machine48k();
    load48kRom(machine);
    machine.reset();

    const payload = [10, 20, 30, 40];
    const tapFile = new Uint8Array([
      ...buildTapBlock(0xff, payload),
      ...buildTapBlock(0xff, payload),
    ]);
    machine.loadTape(parseTap(tapFile));
    machine.fastTapeLoad = true;
    machine.playTape();

    for (let i = 0; i < payload.length; i++) {
      machine.memory.write8(0x9000 + i, payload[i]!);
    }

    machine.cpu.regs.pc = 0x0556;
    machine.cpu.regs.ix = 0x9000;
    machine.cpu.regs.de = payload.length;
    machine.cpu.regs.bytes[RegIndex.A] = 0xff;
    machine.cpu.setFlag(Flag.C, false);
    machine.cpu.push(0x1000);

    runUntilPc(machine, 0x1000);
    expect(machine.cpu.getFlag(Flag.C)).toBe(true);

    machine.memory.write8(0x9000 + 2, 99);

    machine.cpu.regs.pc = 0x0556;
    machine.cpu.regs.ix = 0x9000;
    machine.cpu.regs.de = payload.length;
    machine.cpu.regs.bytes[RegIndex.A] = 0xff;
    machine.cpu.setFlag(Flag.C, false);
    machine.cpu.push(0x2000);

    runUntilPc(machine, 0x2000);
    expect(machine.cpu.getFlag(Flag.C)).toBe(false);
  });

  it("returns carry clear when block flag does not match expected flag", () => {
    const machine = new Machine48k();
    load48kRom(machine);
    machine.reset();

    const tapFile = buildTapBlock(0xff, [1, 2, 3]);
    machine.loadTape(parseTap(tapFile));
    machine.fastTapeLoad = true;
    machine.playTape();

    machine.cpu.regs.pc = 0x0556;
    machine.cpu.regs.ix = 0x8000;
    machine.cpu.regs.de = 3;
    machine.cpu.regs.bytes[RegIndex.A] = 0x00;
    machine.cpu.setFlag(Flag.C, true);
    machine.cpu.push(0x1111);

    runUntilPc(machine, 0x1111);
    expect(machine.cpu.getFlag(Flag.C)).toBe(false);
  });

  it("returns carry clear on corrupted tape block checksum", () => {
    const machine = new Machine48k();
    load48kRom(machine);
    machine.reset();

    const block = buildTapBlock(0xff, [1, 2, 3]);
    block[block.length - 1] = block[block.length - 1]! ^ 0xff;

    machine.loadTape(parseTap(block));
    machine.fastTapeLoad = true;
    machine.playTape();

    machine.cpu.regs.pc = 0x0556;
    machine.cpu.regs.ix = 0x8000;
    machine.cpu.regs.de = 3;
    machine.cpu.regs.bytes[RegIndex.A] = 0xff;
    machine.cpu.setFlag(Flag.C, true);
    machine.cpu.push(0x2222);

    runUntilPc(machine, 0x2222);
    expect(machine.cpu.getFlag(Flag.C)).toBe(false);
  });

  it("Machine128k: intercepts 0x0556 only when ROM 1 (48 BASIC) is paged in", () => {
    const machine = new Machine128k();
    const rom0 = new Uint8Array(16384);
    const rom1 = new Uint8Array(16384);
    rom0[0x0556] = 0x00;
    rom1[0x053f] = 0xf5;
    rom1[0x0540] = 0xfb;
    rom1[0x0541] = 0xf1;
    rom1[0x0542] = 0xc9;
    rom1[0x0556] = 0x14;
    rom1[0x0557] = 0xc9;

    machine.loadRoms(rom0, rom1);
    machine.reset();

    const payload = [11, 22, 33];
    const tapFile = buildTapBlock(0xff, payload);
    machine.loadTape(parseTap(tapFile));
    machine.fastTapeLoad = true;
    machine.playTape();

    machine.cpu.regs.pc = 0x0556;
    machine.step();
    expect(machine.cpu.regs.pc).toBe(0x0557);

    machine.memory.writePagingRegister(0x10);
    expect(machine.memory.romBank).toBe(1);

    machine.cpu.regs.pc = 0x0556;
    machine.cpu.regs.ix = 0x8000;
    machine.cpu.regs.de = payload.length;
    machine.cpu.regs.bytes[RegIndex.A] = 0xff;
    machine.cpu.setFlag(Flag.C, true);
    machine.cpu.push(0x4321);

    runUntilPc(machine, 0x4321);
    expect(machine.cpu.regs.pc).toBe(0x4321);
    expect(machine.cpu.getFlag(Flag.C)).toBe(true);
    expect(machine.memory.read8(0x8000)).toBe(11);
    expect(machine.memory.read8(0x8001)).toBe(22);
    expect(machine.memory.read8(0x8002)).toBe(33);
  });

  it("loads a real multi-block commercial tape (Attribute2You.tap) end-to-end", () => {
    const tapPath = resolve(process.cwd(), "Tapes/TAP/Attribute2You.tap");
    const tapBytes = readFileSync(tapPath);

    const machine = new Machine48k();
    load48kRom(machine);
    machine.reset();

    machine.loadTape(parseTap(tapBytes));
    machine.fastTapeLoad = true;
    machine.playTape();

    expect(machine.tape.hasBlocks()).toBe(true);

    for (let i = 0; i < 4; i++) {
      machine.cpu.regs.pc = 0x0556;
      machine.cpu.regs.ix = 0x5c74;
      machine.cpu.regs.de = 17;
      machine.cpu.regs.bytes[RegIndex.A] = 0x00;
      machine.cpu.setFlag(Flag.C, true);
      machine.cpu.push(0x1000 + i * 2);

      runUntilPc(machine, 0x1000 + i * 2);
      expect(machine.cpu.getFlag(Flag.C)).toBe(true);
      expect(machine.cpu.regs.de).toBe(0);

      const dataLen = machine.memory.read8(0x5c74 + 11) | (machine.memory.read8(0x5c74 + 12) << 8);

      machine.cpu.regs.pc = 0x0556;
      machine.cpu.regs.ix = 0x8000;
      machine.cpu.regs.de = dataLen;
      machine.cpu.regs.bytes[RegIndex.A] = 0xff;
      machine.cpu.setFlag(Flag.C, true);
      machine.cpu.push(0x2000 + i * 2);

      runUntilPc(machine, 0x2000 + i * 2);
      expect(machine.cpu.getFlag(Flag.C)).toBe(true);
      expect(machine.cpu.regs.de).toBe(0);
    }

    expect(machine.tape.hasBlocks()).toBe(false);
    expect(machine.tape.isPlaying()).toBe(false);
  });

  it("intercepts 0x0569 (LD-SEARCH) custom loader entry point and returns via popped return address", () => {
    const machine = new Machine48k();
    load48kRom(machine);
    machine.reset();

    const payload = [100, 101, 102, 103];
    const tapFile = buildTapBlock(0xff, payload);
    machine.loadTape(parseTap(tapFile));
    machine.fastTapeLoad = true;
    machine.playTape();

    machine.cpu.regs.pc = 0x0569;
    machine.cpu.regs.ix = 0xa000;
    machine.cpu.regs.de = payload.length;
    machine.cpu.regs.bytes[RegIndex.A_] = 0xff;
    machine.cpu.regs.bytes[RegIndex.F_] = 0x01;
    machine.cpu.push(0x7890);

    machine.step();

    expect(machine.cpu.regs.pc).toBe(0x7890);
    expect(machine.cpu.getFlag(Flag.C)).toBe(true);
    expect(machine.cpu.regs.de).toBe(0);
    expect(machine.cpu.regs.ix).toBe(0xa000 + payload.length);
    for (let i = 0; i < payload.length; i++) {
      expect(machine.memory.read8(0xa000 + i)).toBe(payload[i]);
    }
  });

  it("loads Fairlight 48K end-to-end with fastTapeLoad", () => {
    const tapPath = resolve(
      process.cwd(),
      "Tapes/TAP/Fairlight - A Prelude (1985)(The Edge Software).tap",
    );
    const tapBytes = readFileSync(tapPath);

    const machine = new Machine48k();
    load48kRom(machine);
    machine.reset();

    machine.loadTape(parseTap(tapBytes));
    machine.fastTapeLoad = true;
    machine.playTape();

    for (let f = 0; f < 90; f++) machine.runFrame();

    typeKeyOnMachine(machine, 6, 3);
    typeKeyOnMachine(machine, 5, 0, 7, 1);
    typeKeyOnMachine(machine, 5, 0, 7, 1);
    typeKeyOnMachine(machine, 6, 0);

    for (let f = 0; f < 50; f++) machine.runFrame();

    expect(machine.tape.hasBlocks()).toBe(false);
    expect(machine.tape.isPlaying()).toBe(false);

    let nonZeroPixels = 0;
    for (let addr = 0x4000; addr < 0x5800; addr++) {
      if (machine.memory.read8(addr) !== 0) nonZeroPixels++;
    }
    expect(nonZeroPixels).toBeGreaterThan(5000);
  });

  it("loads Fairlight 128K (all 22 blocks) end-to-end with fastTapeLoad", () => {
    const rom0Path = resolve(process.cwd(), "rom/128-0.rom");
    const rom1Path = resolve(process.cwd(), "rom/128-1.rom");
    const tapPath = resolve(
      process.cwd(),
      "Tapes/TAP/Fairlight - A Prelude (1985)(The Edge Software)[128K].tap",
    );

    const machine = new Machine128k();
    machine.loadRoms(readFileSync(rom0Path), readFileSync(rom1Path));
    machine.reset();

    machine.loadTape(parseTap(readFileSync(tapPath)));
    machine.fastTapeLoad = true;
    machine.playTape();

    for (let f = 0; f < 60; f++) machine.runFrame();

    machine.keyboard.setKey(6, 0, true);
    for (let f = 0; f < 5; f++) machine.runFrame();
    machine.keyboard.setKey(6, 0, false);

    for (let f = 0; f < 300; f++) {
      machine.runFrame();
      if (!machine.tape.isPlaying()) break;
    }

    expect(machine.tape.hasBlocks()).toBe(false);
    expect(machine.tape.isPlaying()).toBe(false);

    for (let f = 0; f < 50; f++) machine.runFrame();

    let nonZeroPixels = 0;
    for (let addr = 0x4000; addr < 0x5800; addr++) {
      if (machine.memory.read8(addr) !== 0) nonZeroPixels++;
    }
    expect(nonZeroPixels).toBeGreaterThan(5000);
  });

  it("loads tape into Machine48k in stopped state and fast-loads upon play", () => {
    const tapPath = resolve(
      process.cwd(),
      "Tapes/TAP/Fairlight - A Prelude (1985)(The Edge Software).tap",
    );
    const machine = new Machine48k();
    load48kRom(machine);
    machine.reset();

    machine.loadTape(parseTap(readFileSync(tapPath)));
    machine.fastTapeLoad = true;

    expect(machine.tape.isPlaying()).toBe(false);

    for (let f = 0; f < 90; f++) machine.runFrame();

    machine.playTape();
    expect(machine.tape.isPlaying()).toBe(true);

    typeKeyOnMachine(machine, 6, 3);
    typeKeyOnMachine(machine, 5, 0, 7, 1);
    typeKeyOnMachine(machine, 5, 0, 7, 1);
    typeKeyOnMachine(machine, 6, 0);

    for (let f = 0; f < 50; f++) machine.runFrame();

    expect(machine.tape.hasBlocks()).toBe(false);
    expect(machine.tape.isPlaying()).toBe(false);

    let nonZeroPixels = 0;
    for (let addr = 0x4000; addr < 0x5800; addr++) {
      if (machine.memory.read8(addr) !== 0) nonZeroPixels++;
    }
    expect(nonZeroPixels).toBeGreaterThan(5000);
  });

  it("loads tape into Machine128k in stopped state and fast-loads upon play", () => {
    const rom0Path = resolve(process.cwd(), "rom/128-0.rom");
    const rom1Path = resolve(process.cwd(), "rom/128-1.rom");
    const tapPath = resolve(
      process.cwd(),
      "Tapes/TAP/Fairlight - A Prelude (1985)(The Edge Software)[128K].tap",
    );

    const machine = new Machine128k();
    machine.loadRoms(readFileSync(rom0Path), readFileSync(rom1Path));
    machine.reset();

    machine.loadTape(parseTap(readFileSync(tapPath)));
    machine.fastTapeLoad = true;

    expect(machine.tape.isPlaying()).toBe(false);

    for (let f = 0; f < 60; f++) machine.runFrame();

    machine.playTape();
    expect(machine.tape.isPlaying()).toBe(true);

    machine.keyboard.setKey(6, 0, true);
    for (let f = 0; f < 5; f++) machine.runFrame();
    machine.keyboard.setKey(6, 0, false);

    for (let f = 0; f < 300; f++) {
      machine.runFrame();
      if (!machine.tape.isPlaying() && !machine.tape.hasBlocks()) break;
    }

    expect(machine.tape.hasBlocks()).toBe(false);
    expect(machine.tape.isPlaying()).toBe(false);

    for (let f = 0; f < 50; f++) machine.runFrame();

    let nonZeroPixels = 0;
    for (let addr = 0x4000; addr < 0x5800; addr++) {
      if (machine.memory.read8(addr) !== 0) nonZeroPixels++;
    }
    expect(nonZeroPixels).toBeGreaterThan(5000);
  });

  it("smoke test: fast loads Fairlight, resets, then slow loads via cycle-accurate pulses", () => {
    const tapPath = resolve(
      process.cwd(),
      "Tapes/TAP/Fairlight - A Prelude (1985)(The Edge Software).tap",
    );
    const tapBytes = readFileSync(tapPath);
    const machine = new Machine48k();
    load48kRom(machine);
    machine.reset();

    machine.loadTape(parseTap(tapBytes));
    machine.fastTapeLoad = true;
    for (let f = 0; f < 90; f++) machine.runFrame();

    machine.playTape();
    typeKeyOnMachine(machine, 6, 3);
    typeKeyOnMachine(machine, 5, 0, 7, 1);
    typeKeyOnMachine(machine, 5, 0, 7, 1);
    typeKeyOnMachine(machine, 6, 0);

    for (let f = 0; f < 50; f++) machine.runFrame();

    expect(machine.tape.hasBlocks()).toBe(false);
    expect(machine.tape.isPlaying()).toBe(false);
    expect(machine.tape.currentBlockIndex).toBe(5);

    let fastPixels = 0;
    for (let addr = 0x4000; addr < 0x5800; addr++) {
      if (machine.memory.read8(addr) !== 0) fastPixels++;
    }
    expect(fastPixels).toBeGreaterThan(5000);

    machine.reset();
    expect(machine.cpu.regs.pc).toBe(0x0000);
    expect(machine.tape.isPlaying()).toBe(false);

    machine.loadTape(parseTap(tapBytes));
    machine.fastTapeLoad = false;
    expect(machine.tape.isPlaying()).toBe(false);

    for (let f = 0; f < 90; f++) machine.runFrame();

    machine.playTape();
    typeKeyOnMachine(machine, 6, 3);
    typeKeyOnMachine(machine, 5, 0, 7, 1);
    typeKeyOnMachine(machine, 5, 0, 7, 1);
    typeKeyOnMachine(machine, 6, 0);

    for (let f = 0; f < 1000; f++) machine.runFrame();

    expect(machine.tape.currentBlockIndex).toBeGreaterThanOrEqual(3);
    expect(machine.tape.isPlaying()).toBe(true);
  });

  it("smoke test: fast loads and slow loads The Hobbit 48K, checking the fastTapeLoad option explicitly", () => {
    const tapPath = resolve(
      process.cwd(),
      "Tapes/TAP/Hobbit, The v1.2 (1982)(Melbourne House).tap",
    );
    const tapBytes = readFileSync(tapPath);
    const machine = new Machine48k();
    load48kRom(machine);
    machine.reset();

    // Physically check the option itself before relying on its effects.
    expect(machine.fastTapeLoad).toBe(false);

    // --- Fast (instant) load: run to full completion. ---
    machine.loadTape(parseTap(tapBytes));
    machine.fastTapeLoad = true;
    expect(machine.fastTapeLoad).toBe(true);
    for (let f = 0; f < 90; f++) machine.runFrame();

    machine.playTape();
    typeKeyOnMachine(machine, 6, 3); // J -> "LOAD" keyword (K-cursor single-key entry)
    typeKeyOnMachine(machine, 5, 0, 7, 1); // SYMBOL SHIFT+P -> "
    typeKeyOnMachine(machine, 5, 0, 7, 1); // SYMBOL SHIFT+P -> "
    typeKeyOnMachine(machine, 6, 0); // ENTER

    for (let f = 0; f < 300; f++) {
      machine.runFrame();
      if (!machine.tape.isPlaying() && !machine.tape.hasBlocks()) break;
    }

    expect(machine.tape.hasBlocks()).toBe(false);
    expect(machine.tape.isPlaying()).toBe(false);

    // The Hobbit's title screen is less densely drawn than Fairlight's (whose
    // >5000 threshold doesn't hold here) — empirically ~2763/6144 bytes
    // non-zero on a full load; >1500 comfortably distinguishes a real drawn
    // screen from blank/in-progress loading while leaving margin.
    let fastPixels = 0;
    for (let addr = 0x4000; addr < 0x5800; addr++) {
      if (machine.memory.read8(addr) !== 0) fastPixels++;
    }
    expect(fastPixels).toBeGreaterThan(1500);

    // --- Slow (cycle-accurate) load: reset and re-check the option flips back cleanly. ---
    machine.reset();
    expect(machine.tape.isPlaying()).toBe(false);

    machine.loadTape(parseTap(tapBytes));
    machine.fastTapeLoad = false;
    expect(machine.fastTapeLoad).toBe(false);
    for (let f = 0; f < 90; f++) machine.runFrame();

    machine.playTape();
    typeKeyOnMachine(machine, 6, 3); // J -> "LOAD"
    typeKeyOnMachine(machine, 5, 0, 7, 1); // "
    typeKeyOnMachine(machine, 5, 0, 7, 1); // "
    typeKeyOnMachine(machine, 6, 0); // ENTER

    // Cycle-accurate loading of a full 48K game takes real Spectrum minutes —
    // asserting meaningful progress within a bounded frame budget here (same
    // trade-off the Fairlight slow-load smoke test above makes), rather than
    // running the test suite for minutes. Full completion of this exact path
    // was already verified live against a real browser tab via the MCP
    // bridge (~4 minutes real time, arrived at the title screen correctly).
    for (let f = 0; f < 2000; f++) machine.runFrame();

    expect(machine.tape.isPlaying()).toBe(true);
    expect(machine.tape.currentBlockIndex).toBeGreaterThan(0);
  });
});
