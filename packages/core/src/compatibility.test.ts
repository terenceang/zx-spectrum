import { describe, expect, it } from "vitest";
import { AyChip } from "./audio/ayChip.js";
import { Flag } from "./cpu/flags.js";
import { RegIndex } from "./cpu/registers.js";
import { MSR_RQM } from "./disk/fdc765.js";
import { applySnapshotTo128k, applySnapshotTo48k } from "./loaders/apply.js";
import { parseSna, writeSna128k, writeSna48k } from "./loaders/sna.js";
import { parseTap } from "./loaders/tap.js";
import { Machine128k } from "./machines/machine128k.js";
import { Machine48k } from "./machines/machine48k.js";
import { MachinePlus3 } from "./machines/machinePlus3.js";
import { paletteIndex } from "./ula/palette.js";
import {
  CONTENTION_PATTERN,
  ULA_128K_PROFILE,
  ULA_48K_PROFILE,
  ULA_PLUS3_PROFILE,
  tStatesPerFrame,
} from "./ula/timingProfile.js";

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

describe("ZX Spectrum Compatibility Suite", () => {
  describe("1. Contention & Cycle Timing Accuracy", () => {
    it("matches the exact 48K contention window and cycle delay table", () => {
      const machine = new Machine48k();
      const profile = ULA_48K_PROFILE;

      expect(profile.firstContendedTstate).toBe(14335);
      expect(profile.tStatesPerLine).toBe(224);
      expect(profile.contendedLines).toBe(192);

      expect(machine.ula.contentionDelay(14334)).toBe(0);

      for (let i = 0; i < 8; i++) {
        expect(machine.ula.contentionDelay(profile.firstContendedTstate + i)).toBe(
          CONTENTION_PATTERN[i],
        );
      }

      expect(machine.ula.contentionDelay(profile.firstContendedTstate + 128)).toBe(0);
      expect(machine.ula.contentionDelay(profile.firstContendedTstate + 200)).toBe(0);

      expect(machine.ula.contentionDelay(profile.firstContendedTstate + 224)).toBe(6);

      const afterContendedLines = profile.firstContendedTstate + 192 * profile.tStatesPerLine;
      expect(machine.ula.contentionDelay(afterContendedLines)).toBe(0);
    });

    it("matches 48K contended memory boundaries (0x4000..0x7FFF contended, 0x8000+ uncontended)", () => {
      const machine = new Machine48k();
      expect(machine.memory.isContended(0x0000)).toBe(false);
      expect(machine.memory.isContended(0x3fff)).toBe(false);
      expect(machine.memory.isContended(0x4000)).toBe(true);
      expect(machine.memory.isContended(0x5800)).toBe(true);
      expect(machine.memory.isContended(0x7fff)).toBe(true);
      expect(machine.memory.isContended(0x8000)).toBe(false);
      expect(machine.memory.isContended(0xffff)).toBe(false);
    });

    it("applies accurate cycle delays during 48K contended memory execution", () => {
      const machine = new Machine48k();
      machine.reset();

      machine.memory.poke8(0x4000, 0x00);
      machine.cpu.regs.pc = 0x4000;

      machine.tStates = ULA_48K_PROFILE.firstContendedTstate;
      const initialT = machine.tStates;

      machine.step();
      expect(machine.tStates - initialT).toBe(6 + 4);
    });

    it("follows 128K bank contention rules (odd banks 1, 3, 5, 7 contended; even banks uncontended)", () => {
      const machine = new Machine128k();

      expect(machine.memory.isContended(0x4000)).toBe(true);
      expect(machine.memory.isContended(0x8000)).toBe(false);

      machine.memory.writePagingRegister(0x00);
      expect(machine.memory.isContended(0xc000)).toBe(false);

      machine.memory.writePagingRegister(0x01);
      expect(machine.memory.isContended(0xc000)).toBe(true);

      machine.memory.writePagingRegister(0x03);
      expect(machine.memory.isContended(0xc000)).toBe(true);

      machine.memory.writePagingRegister(0x04);
      expect(machine.memory.isContended(0xc000)).toBe(false);

      machine.memory.writePagingRegister(0x07);
      expect(machine.memory.isContended(0xc000)).toBe(true);
    });

    it("follows +3 bank contention rules (banks 4, 5, 6, 7 contended; banks 0, 1, 2, 3 uncontended)", () => {
      const machine = new MachinePlus3();

      expect(machine.memory.isContended(0x4000)).toBe(true);
      expect(machine.memory.isContended(0x8000)).toBe(false);

      machine.writePort(0x7ffd, 0x03);
      expect(machine.memory.isContended(0xc000)).toBe(false);

      machine.writePort(0x7ffd, 0x04);
      expect(machine.memory.isContended(0xc000)).toBe(true);
    });

    it("verifies frame budgets and maskable interrupt line timing across all models", () => {
      const m48 = new Machine48k();
      const m128 = new Machine128k();
      const mPlus3 = new MachinePlus3();

      expect(m48.frameTStateBudget).toBe(69888);
      expect(tStatesPerFrame(ULA_48K_PROFILE)).toBe(69888);
      m48.tStates = 0;
      expect(m48.intPending()).toBe(true);
      m48.tStates = 31;
      expect(m48.intPending()).toBe(true);
      m48.tStates = 32;
      expect(m48.intPending()).toBe(false);

      expect(m128.frameTStateBudget).toBe(70908);
      expect(tStatesPerFrame(ULA_128K_PROFILE)).toBe(70908);
      m128.tStates = 0;
      expect(m128.intPending()).toBe(true);
      m128.tStates = 35;
      expect(m128.intPending()).toBe(true);
      m128.tStates = 36;
      expect(m128.intPending()).toBe(false);

      expect(mPlus3.frameTStateBudget).toBe(70908);
      expect(tStatesPerFrame(ULA_PLUS3_PROFILE)).toBe(70908);
      mPlus3.tStates = 0;
      expect(mPlus3.intPending()).toBe(true);
      mPlus3.tStates = 31;
      expect(mPlus3.intPending()).toBe(true);
      mPlus3.tStates = 32;
      expect(mPlus3.intPending()).toBe(false);
    });
  });

  describe("2. 128K Banking & Port 0x7FFD Protocol", () => {
    it("pages all 8 RAM banks independently at 0xC000..0xFFFF", () => {
      const machine = new Machine128k();
      machine.reset();

      for (let bank = 0; bank < 8; bank++) {
        machine.writePort(0x7ffd, bank);
        machine.memory.write8(0xc000, 0xa0 + bank);
        machine.memory.write8(0xffff, 0xb0 + bank);
      }

      for (let bank = 0; bank < 8; bank++) {
        machine.writePort(0x7ffd, bank);
        expect(machine.memory.read8(0xc000)).toBe(0xa0 + bank);
        expect(machine.memory.read8(0xffff)).toBe(0xb0 + bank);
      }
    });

    it("swaps ROM 0 (128K Editor) and ROM 1 (48K BASIC) via bit 4", () => {
      const machine = new Machine128k();
      const rom0 = new Uint8Array(16384).fill(0x12);
      const rom1 = new Uint8Array(16384).fill(0x34);
      machine.loadRoms(rom0, rom1);

      machine.writePort(0x7ffd, 0x00);
      expect(machine.memory.romBank).toBe(0);
      expect(machine.memory.read8(0x0000)).toBe(0x12);

      machine.writePort(0x7ffd, 0x10);
      expect(machine.memory.romBank).toBe(1);
      expect(machine.memory.read8(0x0000)).toBe(0x34);
    });

    it("enforces paging lockout once bit 5 is written", () => {
      const machine = new Machine128k();
      machine.reset();

      machine.writePort(0x7ffd, 0x03);
      machine.memory.write8(0xc000, 0x33);

      machine.writePort(0x7ffd, 0x24);
      machine.memory.write8(0xc000, 0x44);

      machine.writePort(0x7ffd, 0x01);
      expect(machine.memory.port7ffd).toBe(0x24);
      expect(machine.memory.read8(0xc000)).toBe(0x44);

      machine.reset();
      machine.writePort(0x7ffd, 0x01);
      expect(machine.memory.port7ffd).toBe(0x01);
    });

    it("swaps ULA display between primary screen (Bank 5) and shadow screen (Bank 7)", () => {
      const machine = new Machine128k();
      machine.reset();

      machine.memory.pokeBank(5, new Uint8Array(16384).fill(0x55));
      machine.memory.pokeBank(7, new Uint8Array(16384).fill(0x77));

      machine.writePort(0x7ffd, 0x00);
      expect(machine.memory.screenBytes[0]).toBe(0x55);

      machine.writePort(0x7ffd, 0x08);
      expect(machine.memory.screenBytes[0]).toBe(0x77);
    });
  });

  describe("3. +3 Memory Architecture & Special All-RAM Modes", () => {
    it("supports all 4 Special All-RAM paging configurations via port 0x1FFD", () => {
      const machine = new MachinePlus3();
      machine.reset();

      for (let bank = 0; bank < 8; bank++) {
        machine.memory.pokeBank(bank, new Uint8Array(16384).fill(0x10 * bank + 1));
      }

      machine.writePort(0x1ffd, 0x01);
      expect(machine.memory.read8(0x0000)).toBe(0x01);
      expect(machine.memory.read8(0x4000)).toBe(0x11);
      expect(machine.memory.read8(0x8000)).toBe(0x21);
      expect(machine.memory.read8(0xc000)).toBe(0x31);

      machine.writePort(0x1ffd, 0x03);
      expect(machine.memory.read8(0x0000)).toBe(0x41);
      expect(machine.memory.read8(0x4000)).toBe(0x51);
      expect(machine.memory.read8(0x8000)).toBe(0x61);
      expect(machine.memory.read8(0xc000)).toBe(0x71);

      machine.writePort(0x1ffd, 0x05);
      expect(machine.memory.read8(0x0000)).toBe(0x41);
      expect(machine.memory.read8(0x4000)).toBe(0x51);
      expect(machine.memory.read8(0x8000)).toBe(0x61);
      expect(machine.memory.read8(0xc000)).toBe(0x31);

      machine.writePort(0x1ffd, 0x07);
      expect(machine.memory.read8(0x0000)).toBe(0x41);
      expect(machine.memory.read8(0x4000)).toBe(0x71);
      expect(machine.memory.read8(0x8000)).toBe(0x61);
      expect(machine.memory.read8(0xc000)).toBe(0x31);
    });

    it("enables write access to 0x0000..0x3FFF in All-RAM mode", () => {
      const machine = new MachinePlus3();
      machine.reset();

      machine.memory.write8(0x0000, 0x99);
      expect(machine.memory.read8(0x0000)).toBe(0x00);

      machine.writePort(0x1ffd, 0x01);
      machine.memory.write8(0x0000, 0x99);
      expect(machine.memory.read8(0x0000)).toBe(0x99);
    });

    it("controls disk motor via bit 3 of port 0x1FFD", () => {
      const machine = new MachinePlus3();
      machine.reset();
      expect(machine.fdc.isMotorOn).toBe(false);

      machine.writePort(0x1ffd, 0x08);
      expect(machine.fdc.isMotorOn).toBe(true);

      machine.writePort(0x1ffd, 0x00);
      expect(machine.fdc.isMotorOn).toBe(false);
    });
  });

  describe("4. ULA Display & Raster Rendering", () => {
    it("maps interleaved screen memory lines across all 3 display sections correctly", () => {
      const machine = new Machine48k();
      machine.reset();

      machine.memory.poke8(0x4000, 0x80);
      machine.memory.poke8(0x4000 + 2048, 0x80);
      machine.memory.poke8(0x4000 + 4096, 0x80);

      machine.memory.poke8(0x5800, 0x3a);
      machine.memory.poke8(0x5800 + 256, 0x3a);
      machine.memory.poke8(0x5800 + 512, 0x3a);

      machine.runFrame();
      const { pixels, width } = machine.getFrameBuffer();
      const topBorder = 48;
      const sideBorder = 32;

      expect(pixels[topBorder * width + sideBorder]).toBe(paletteIndex(2, false));
      expect(pixels[(topBorder + 64) * width + sideBorder]).toBe(paletteIndex(2, false));
      expect(pixels[(topBorder + 128) * width + sideBorder]).toBe(paletteIndex(2, false));
    });

    it("inverts flash attributes exactly every 16 frames", () => {
      const machine = new Machine48k();
      machine.reset();

      machine.memory.poke8(0x4000, 0xff);
      machine.memory.poke8(0x5800, 0x84);

      const topBorder = 48;
      const sideBorder = 32;

      for (let i = 0; i < 15; i++) {
        machine.runFrame();
      }
      let fb = machine.getFrameBuffer();
      expect(fb.pixels[topBorder * fb.width + sideBorder]).toBe(paletteIndex(4, false));

      machine.runFrame();
      fb = machine.getFrameBuffer();
      expect(fb.pixels[topBorder * fb.width + sideBorder]).toBe(paletteIndex(0, false));
    });

    it("renders mid-frame border color changes with beam accuracy", () => {
      const machine = new Machine48k();
      machine.reset();
      machine.ula.setBorder(1);

      machine.ula.beginFrame();
      const line10T = ULA_48K_PROFILE.firstContendedTstate - 48 * 224 - 16 + 10 * 224;

      machine.ula.writePort(line10T + 40, 3);
      const { pixels, width } = machine.getFrameBuffer();
      const rowBase = 10 * width;

      expect(pixels[rowBase + 20]).toBe(paletteIndex(1, false));
      expect(pixels[rowBase + 100]).toBe(paletteIndex(3, false));
    });
  });

  describe("5. AY-3-8912 Programmable Sound Generator", () => {
    it("writes and reads registers via ports 0xFFFD and 0xBFFD", () => {
      const machine = new Machine128k();
      machine.reset();

      machine.writePort(0xfffd, 0);
      machine.writePort(0xbffd, 0xab);
      expect(machine.readPort(0xfffd)).toBe(0xab);

      machine.writePort(0xfffd, 1);
      machine.writePort(0xbffd, 0x0f);
      expect(machine.readPort(0xfffd)).toBe(0x0f);

      machine.writePort(0xfffd, 7);
      machine.writePort(0xbffd, 0x3e);
      expect(machine.readPort(0xfffd)).toBe(0x3e);
    });

    it("generates stereo audio samples across channels", () => {
      const ay = new AyChip();
      ay.reset();

      ay.selectRegister(0);
      ay.writeData(100);
      ay.selectRegister(8);
      ay.writeData(15);
      ay.selectRegister(7);
      ay.writeData(0x3e);

      const mono = ay.renderFrame(100, 44100);
      expect(mono.length).toBe(100);
      const hasNonZero = mono.some((s) => s > 0);
      expect(hasNonZero).toBe(true);

      const stereo = ay.renderFrameStereo(100, 44100);
      expect(stereo.left.length).toBe(100);
      expect(stereo.right.length).toBe(100);
    });
  });

  describe("6. I/O Bus Decoding, Floating Bus & Peripherals", () => {
    it("reads multiple key combinations across different matrix half-rows", () => {
      const machine = new Machine48k();
      machine.reset();

      machine.keyboard.setKey(0, 0, true);
      machine.keyboard.setKey(7, 0, true);

      expect(machine.readPort(0xfefe) & 0x01).toBe(0);
      expect(machine.readPort(0xfefe) & 0x1e).toBe(0x1e);

      expect(machine.readPort(0x7ffe) & 0x01).toBe(0);

      const combined = machine.readPort(0x7efe);
      expect(combined & 0x01).toBe(0);
    });

    it("isolates Kempston joystick port 0x1F and returns 0xFF for floating bus", () => {
      const machine = new Machine48k();
      machine.reset();

      machine.joystick.set("right", true);
      machine.joystick.set("fire", true);

      expect(machine.readPort(0x1f)).toBe(0x11);

      expect(machine.readPort(0x00fe) & 0x1f).toBe(0x1f);

      expect(machine.readPort(0x43)).toBe(0xff);
      expect(machine.readPort(0x7b)).toBe(0xff);
    });
  });

  describe("7. Tape Traps & Fast Loading", () => {
    it("intercepts standard ROM LD-BYTES at 0x0556 with fastTapeLoad", () => {
      const machine = new Machine48k();
      machine.reset();
      machine.fastTapeLoad = true;

      const payload = [0x11, 0x22, 0x33, 0x44];
      const tap = buildTapBlock(0xff, payload);
      machine.loadTape(parseTap(tap));
      machine.playTape();

      machine.cpu.regs.pc = 0x0556;
      machine.cpu.regs.ix = 0x8000;
      machine.cpu.regs.de = 4;
      machine.cpu.regs.bytes[RegIndex.A] = 0xff;
      machine.cpu.setFlag(Flag.C, true);

      machine.step();

      expect(machine.cpu.getFlag(Flag.C)).toBe(true);
      expect(machine.memory.read8(0x8000)).toBe(0x11);
      expect(machine.memory.read8(0x8001)).toBe(0x22);
      expect(machine.memory.read8(0x8002)).toBe(0x33);
      expect(machine.memory.read8(0x8003)).toBe(0x44);
      expect(machine.cpu.regs.pc).toBe(0x053f);
    });

    it("rejects tape blocks with checksum mismatches gracefully", () => {
      const machine = new Machine48k();
      machine.reset();
      machine.fastTapeLoad = true;

      const corruptTap = buildTapBlock(0xff, [0x01, 0x02]);
      corruptTap[corruptTap.length - 1]! ^= 0xff;
      machine.loadTape(parseTap(corruptTap));
      machine.playTape();

      machine.cpu.regs.pc = 0x0556;
      machine.cpu.regs.ix = 0x9000;
      machine.cpu.regs.de = 2;
      machine.cpu.regs.bytes[RegIndex.A] = 0xff;
      machine.cpu.setFlag(Flag.C, true);

      machine.step();

      expect(machine.cpu.getFlag(Flag.C)).toBe(false);
    });

    it("only activates 128K tape trap when ROM 1 (48 BASIC) is paged", () => {
      const machine = new Machine128k();
      machine.reset();
      machine.fastTapeLoad = true;

      machine.writePort(0x7ffd, 0x00);
      machine.cpu.regs.pc = 0x0556;
      const initialPc = machine.cpu.regs.pc;
      machine.step();
      expect(machine.cpu.regs.pc).not.toBe(0x053f);
      expect(machine.cpu.regs.pc).toBe(initialPc + 1);
    });
  });

  describe("8. Floppy Disk Controller (+3 FDC 765)", () => {
    it("routes FDC MSR and Data ports on the +3 I/O bus", () => {
      const machine = new MachinePlus3();
      machine.reset();

      const msr = machine.readPort(0x2ffd);
      expect((msr & MSR_RQM) !== 0).toBe(true);

      machine.writePort(0x3ffd, 0x0f);
      machine.writePort(0x3ffd, 0x00);
      machine.writePort(0x3ffd, 5);
      expect(machine.fdc.currentTrack).toBe(5);

      machine.writePort(0x3ffd, 0x08);
      const st0 = machine.readPort(0x3ffd);
      const pcn = machine.readPort(0x3ffd);
      expect(st0 & 0x20).toBe(0x20);
      expect(pcn).toBe(5);
    });
  });

  describe("9. Snapshot Integrity & Full Round-Trip", () => {
    it("round-trips full 48K state including registers, SP, PC, and memory", () => {
      const original = new Machine48k();
      original.reset();
      original.memory.poke8(0x5000, 0xaa);
      original.memory.poke8(0x9000, 0xbb);
      original.cpu.regs.pc = 0x7890;
      original.cpu.regs.sp = 0xa000;
      original.cpu.regs.hl = 0x1234;
      original.ula.setBorder(4);

      const sna = writeSna48k(original, original.ula.borderColor);
      const parsed = parseSna(sna);

      const target = new Machine48k();
      applySnapshotTo48k(target, parsed);

      expect(target.cpu.regs.pc).toBe(0x7890);
      expect(target.cpu.regs.sp).toBe(0xa000);
      expect(target.cpu.regs.hl).toBe(0x1234);
      expect(target.memory.read8(0x5000)).toBe(0xaa);
      expect(target.memory.read8(0x9000)).toBe(0xbb);
      expect(target.ula.borderColor).toBe(4);
    });

    it("round-trips 128K state preserving all 8 RAM banks and shadow screen", () => {
      const original = new Machine128k();
      original.reset();

      original.writePort(0x7ffd, 0x1b);
      original.memory.pokeBank(5, new Uint8Array(16384).fill(0x50));
      original.memory.pokeBank(7, new Uint8Array(16384).fill(0x70));
      original.cpu.regs.pc = 0xbeef;
      original.cpu.regs.sp = 0xffe0;
      original.ula.setBorder(6);

      const sna = writeSna128k(original, original.ula.borderColor);
      const parsed = parseSna(sna);

      const target = new Machine128k();
      applySnapshotTo128k(target, parsed);

      expect(target.cpu.regs.pc).toBe(0xbeef);
      expect(target.cpu.regs.sp).toBe(0xffe0);
      expect(target.ula.borderColor).toBe(6);
      expect(target.memory.port7ffd).toBe(0x1b);
      expect(target.memory.screenBytes[0]).toBe(0x70);
    });
  });
});
