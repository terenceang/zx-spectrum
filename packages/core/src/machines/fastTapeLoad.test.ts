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
  const blockLength = 1 + payload.length + 1; // flag + payload + checksum
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
    syntheticRom[0x053f] = 0xf5; // PUSH AF
    syntheticRom[0x0540] = 0xfb; // EI
    syntheticRom[0x0541] = 0xf1; // POP AF
    syntheticRom[0x0542] = 0xc9; // RET
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

    // 1. Simulate ROM calling LD-BYTES for header
    machine.cpu.regs.pc = 0x0556;
    machine.cpu.regs.ix = 0x5c74; // sysvars buffer
    machine.cpu.regs.de = headerPayload.length;
    machine.cpu.regs.bytes[RegIndex.A] = 0x00;
    machine.cpu.setFlag(Flag.C, true); // LOAD
    machine.cpu.push(0x1234); // return address on stack

    // Step until return address 0x1234 reached: trap intercepts 0x0556 -> 0x053F -> RET to 0x1234
    runUntilPc(machine, 0x1234);

    expect(machine.cpu.regs.pc).toBe(0x1234);
    expect(machine.cpu.getFlag(Flag.C)).toBe(true);
    expect(machine.cpu.regs.de).toBe(0);
    expect(machine.cpu.regs.ix).toBe(0x5c74 + headerPayload.length);

    for (let i = 0; i < headerPayload.length; i++) {
      expect(machine.memory.read8(0x5c74 + i)).toBe(headerPayload[i]);
    }

    // 2. Simulate ROM calling LD-BYTES for data block
    machine.cpu.regs.pc = 0x0556;
    machine.cpu.regs.ix = 0x8000;
    machine.cpu.regs.de = dataPayload.length;
    machine.cpu.regs.bytes[RegIndex.A] = 0xff;
    machine.cpu.setFlag(Flag.C, true); // LOAD
    machine.cpu.push(0x5678);

    runUntilPc(machine, 0x5678);

    expect(machine.cpu.regs.pc).toBe(0x5678);
    expect(machine.cpu.getFlag(Flag.C)).toBe(true);
    expect(machine.cpu.regs.de).toBe(0);
    expect(machine.cpu.regs.ix).toBe(0x8000 + dataPayload.length);

    for (let i = 0; i < dataPayload.length; i++) {
      expect(machine.memory.read8(0x8000 + i)).toBe(dataPayload[i]);
    }

    // All blocks consumed -> tape stops playing
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

    // Stepping one instruction should execute opcode at 0x0556 (INC D in 48K ROM)
    machine.step();
    expect(machine.cpu.regs.pc).toBe(0x0557);
    expect(machine.cpu.regs.bytes[RegIndex.D]).toBe(6); // INC D incremented D
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

    // Pre-fill memory matching the payload
    for (let i = 0; i < payload.length; i++) {
      machine.memory.write8(0x9000 + i, payload[i]!);
    }

    // VERIFY match:
    machine.cpu.regs.pc = 0x0556;
    machine.cpu.regs.ix = 0x9000;
    machine.cpu.regs.de = payload.length;
    machine.cpu.regs.bytes[RegIndex.A] = 0xff;
    machine.cpu.setFlag(Flag.C, false); // VERIFY
    machine.cpu.push(0x1000);

    runUntilPc(machine, 0x1000);
    expect(machine.cpu.getFlag(Flag.C)).toBe(true); // match -> Carry set

    // Corrupt memory for second verify:
    machine.memory.write8(0x9000 + 2, 99);

    machine.cpu.regs.pc = 0x0556;
    machine.cpu.regs.ix = 0x9000;
    machine.cpu.regs.de = payload.length;
    machine.cpu.regs.bytes[RegIndex.A] = 0xff;
    machine.cpu.setFlag(Flag.C, false); // VERIFY
    machine.cpu.push(0x2000);

    runUntilPc(machine, 0x2000);
    expect(machine.cpu.getFlag(Flag.C)).toBe(false); // mismatch -> Carry clear
  });

  it("returns carry clear when block flag does not match expected flag", () => {
    const machine = new Machine48k();
    load48kRom(machine);
    machine.reset();

    // Tape has data block (0xFF)
    const tapFile = buildTapBlock(0xff, [1, 2, 3]);
    machine.loadTape(parseTap(tapFile));
    machine.fastTapeLoad = true;
    machine.playTape();

    // Caller asks for header (0x00)
    machine.cpu.regs.pc = 0x0556;
    machine.cpu.regs.ix = 0x8000;
    machine.cpu.regs.de = 3;
    machine.cpu.regs.bytes[RegIndex.A] = 0x00; // Expected header
    machine.cpu.setFlag(Flag.C, true);
    machine.cpu.push(0x1111);

    runUntilPc(machine, 0x1111);
    expect(machine.cpu.getFlag(Flag.C)).toBe(false); // flag mismatch -> Carry clear
  });

  it("returns carry clear on corrupted tape block checksum", () => {
    const machine = new Machine48k();
    load48kRom(machine);
    machine.reset();

    const block = buildTapBlock(0xff, [1, 2, 3]);
    // Corrupt checksum byte
    block[block.length - 1] = (block[block.length - 1]! ^ 0xff);

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
    expect(machine.cpu.getFlag(Flag.C)).toBe(false); // checksum error -> Carry clear
  });

  it("Machine128k: intercepts 0x0556 only when ROM 1 (48 BASIC) is paged in", () => {
    const machine = new Machine128k();
    const rom0 = new Uint8Array(16384);
    const rom1 = new Uint8Array(16384);
    // In ROM 0, 0x0556 is NOP (0x00)
    rom0[0x0556] = 0x00;
    // In ROM 1, 0x053F is cleanup, 0x0556 is INC D (0x14)
    rom1[0x053f] = 0xf5; // PUSH AF
    rom1[0x0540] = 0xfb; // EI
    rom1[0x0541] = 0xf1; // POP AF
    rom1[0x0542] = 0xc9; // RET
    rom1[0x0556] = 0x14; // INC D
    rom1[0x0557] = 0xc9;

    machine.loadRoms(rom0, rom1);
    machine.reset();

    const payload = [11, 22, 33];
    const tapFile = buildTapBlock(0xff, payload);
    machine.loadTape(parseTap(tapFile));
    machine.fastTapeLoad = true;
    machine.playTape();

    // 1. With ROM 0 paged in (default after reset, bit 4 of 7FFD is 0):
    machine.cpu.regs.pc = 0x0556;
    machine.step();
    // Should NOT trap because ROM 0 is paged in:
    expect(machine.cpu.regs.pc).toBe(0x0557);

    // 2. Now page in ROM 1 (write 0x10 to port 0x7FFD):
    machine.memory.writePagingRegister(0x10);
    expect(machine.memory.romBank).toBe(1);

    machine.cpu.regs.pc = 0x0556;
    machine.cpu.regs.ix = 0x8000;
    machine.cpu.regs.de = payload.length;
    machine.cpu.regs.bytes[RegIndex.A] = 0xff;
    machine.cpu.setFlag(Flag.C, true);
    machine.cpu.push(0x4321);

    runUntilPc(machine, 0x4321);
    // Should trap because ROM 1 is paged in:
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

    // Attribute2You has 8 blocks (4 pairs of header + data)
    for (let i = 0; i < 4; i++) {
      // Header: flag 0x00, length 17
      machine.cpu.regs.pc = 0x0556;
      machine.cpu.regs.ix = 0x5c74;
      machine.cpu.regs.de = 17;
      machine.cpu.regs.bytes[RegIndex.A] = 0x00;
      machine.cpu.setFlag(Flag.C, true);
      machine.cpu.push(0x1000 + i * 2);

      runUntilPc(machine, 0x1000 + i * 2);
      expect(machine.cpu.getFlag(Flag.C)).toBe(true);
      expect(machine.cpu.regs.de).toBe(0);

      // Data block length from header bytes 11..12
      const dataLen = machine.memory.read8(0x5c74 + 11) | (machine.memory.read8(0x5c74 + 12) << 8);

      // Data: flag 0xFF, length dataLen
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
});
