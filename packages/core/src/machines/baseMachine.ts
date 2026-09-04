import type { MemoryAccessTag, Z80Bus } from "../cpu/bus.js";
import { Flag } from "../cpu/flags.js";
import { RegIndex } from "../cpu/registers.js";
import { Z80 } from "../cpu/z80.js";
import { KeyboardState } from "../io/keyboard.js";
import { TapeEdgePlayer } from "../loaders/tapePlayer.js";
import type { TapePulseSequence } from "../loaders/tapePulse.js";
import type { MemoryDevice } from "../memory/memoryDevice.js";
import type { UlaEngine } from "../ula/ulaEngine.js";
import type { FrameBuffer } from "./types.js";

/** Abstract base Spectrum machine composing the Z80 CPU, keyboard, tape, memory,
 * and ULA into a runnable system. Implements Z80Bus so memory access, contention,
 * and interrupt handling are unified across 48K, 128K, and future variants. */
export abstract class BaseMachine<M extends MemoryDevice = MemoryDevice> implements Z80Bus {
  readonly cpu: Z80;
  readonly keyboard = new KeyboardState();
  readonly tape = new TapeEdgePlayer();
  tapeSoundEnabled = true;
  fastTapeLoad = false;

  abstract readonly memory: M;
  abstract readonly ula: UlaEngine;
  abstract readonly frameTStateBudget: number;

  tStates = 0;
  totalTStates = 0;
  protected frameStartTotalT = 0;

  constructor() {
    this.cpu = new Z80(this);
  }

  loadTape(pulses: TapePulseSequence): void {
    this.tape.load(pulses);
  }

  playTape(): void {
    this.tape.start(this.totalTStates);
  }

  stopTape(): void {
    this.tape.stop();
  }

  reset(): void {
    this.cpu.reset();
    this.keyboard.reset();
    this.ula.reset();
    this.tape.stop();
    this.tStates = 0;
  }

  protected abstract isTapeTrapActive(): boolean;

  /** Intercepts standard ROM loader routines (address 0x0556: LD-BYTES and
   * address 0x0569: LD-SEARCH, used by custom loaders like Fairlight) to instantly
   * transfer tape blocks into memory. */
  protected executeTapeTrap(): boolean {
    const block = this.tape.getNextBlock();
    if (!block) {
      return false;
    }

    const isAt569 = this.cpu.regs.pc === 0x0569;
    const expectedFlag = isAt569 ? this.cpu.regs.bytes[RegIndex.A_]! : this.cpu.regs.bytes[RegIndex.A]!;
    const isLoad = isAt569 ? (this.cpu.regs.bytes[RegIndex.F_]! & 1) !== 0 : this.cpu.getFlag(Flag.C);
    const startAddr = this.cpu.regs.ix;
    const requestedLength = this.cpu.regs.de;

    const returnExit = (success: boolean): void => {
      this.cpu.setFlag(Flag.C, success);
      if (isAt569) {
        this.cpu.regs.pc = this.cpu.pop();
      } else {
        this.cpu.regs.pc = 0x053f;
      }
    };

    const blockData = block.data;
    if (blockData.length < 2) {
      this.tape.advanceBlock(this.totalTStates);
      returnExit(false);
      return true;
    }

    const blockFlag = blockData[0]!;
    if (blockFlag !== expectedFlag) {
      this.tape.advanceBlock(this.totalTStates);
      returnExit(false);
      return true;
    }

    let xorSum = 0;
    for (let i = 0; i < blockData.length; i++) {
      xorSum ^= blockData[i]!;
    }
    if (xorSum !== 0) {
      this.tape.advanceBlock(this.totalTStates);
      returnExit(false);
      return true;
    }

    const payloadLength = blockData.length - 2;
    const bytesToTransfer = Math.min(requestedLength, payloadLength);

    let verifyMismatch = false;
    if (isLoad) {
      for (let i = 0; i < bytesToTransfer; i++) {
        this.memory.write8((startAddr + i) & 0xffff, blockData[1 + i]!);
      }
    } else {
      for (let i = 0; i < bytesToTransfer; i++) {
        if (this.memory.read8((startAddr + i) & 0xffff) !== blockData[1 + i]!) {
          verifyMismatch = true;
          break;
        }
      }
    }

    this.tape.advanceBlock(this.totalTStates);

    if (verifyMismatch || requestedLength > payloadLength) {
      returnExit(false);
      return true;
    }

    this.cpu.regs.ix = (startAddr + requestedLength) & 0xffff;
    this.cpu.regs.de = 0;
    this.cpu.regs.bytes[RegIndex.A] = 0;
    this.cpu.setFlag(Flag.Z, false);
    const checksumByte = blockData[blockData.length - 1]!;
    this.cpu.regs.hl = checksumByte;
    returnExit(true);
    return true;
  }

  step(): void {
    if (this.fastTapeLoad && this.isTapeTrapActive()) {
      if (this.executeTapeTrap()) {
        this.tick(50);
        return;
      }
    }
    this.cpu.step();
  }

  runFrame(): void {
    this.ula.beginFrame();
    this.tStates = 0;
    this.frameStartTotalT = this.totalTStates;
    let steps = 0;
    while (this.tStates < this.frameTStateBudget) {
      this.step();
      if (++steps > 100_000) {
        throw new Error("runFrame: exceeded 100 000 steps — possible infinite loop");
      }
    }
  }

  getFrameBuffer(): FrameBuffer {
    return this.ula.renderFrame(this.memory);
  }

  abstract getAudioSamples(sampleCount: number, sampleRate?: number): Float32Array;
  abstract getStereoAudioSamples(sampleCount: number, sampleRate?: number): Float32Array;

  protected mixAudio(
    beeper: Float32Array,
    sampleCount: number,
    beeperScale = 1,
    extraAudio: Float32Array | null = null,
    extraScale = 1,
  ): Float32Array {
    const tapeAudio =
      this.tapeSoundEnabled && this.tape.isPlaying()
        ? this.tape.renderFrameAudio(this.frameStartTotalT, this.frameTStateBudget, sampleCount)
        : null;

    if (!tapeAudio && beeperScale === 1 && !extraAudio) {
      return beeper;
    }

    const out = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      let sum = beeper[i]! * beeperScale;
      if (extraAudio) sum += extraAudio[i]! * extraScale;
      if (tapeAudio) sum += tapeAudio[i]! * 0.4;
      out[i] = Math.max(-1, Math.min(1, sum));
    }
    return out;
  }

  protected mixAudioStereo(
    beeper: Float32Array,
    sampleCount: number,
    beeperScale = 1,
    extraLeft: Float32Array | null = null,
    extraRight: Float32Array | null = null,
    extraScale = 1,
  ): Float32Array {
    const tapeAudio =
      this.tapeSoundEnabled && this.tape.isPlaying()
        ? this.tape.renderFrameAudio(this.frameStartTotalT, this.frameTStateBudget, sampleCount)
        : null;

    const out = new Float32Array(sampleCount * 2);
    for (let i = 0; i < sampleCount; i++) {
      const beep = beeper[i]! * beeperScale;
      const tape = tapeAudio ? tapeAudio[i]! * 0.4 : 0;
      let left = beep + tape;
      let right = beep + tape;
      if (extraLeft) left += extraLeft[i]! * extraScale;
      if (extraRight) right += extraRight[i]! * extraScale;
      out[i * 2] = Math.max(-1, Math.min(1, left));
      out[i * 2 + 1] = Math.max(-1, Math.min(1, right));
    }
    return out;
  }

  // ---- Z80Bus ---------------------------------------------------------------

  protected tick(count: number): void {
    this.tStates += count;
    this.totalTStates += count;
  }

  protected applyContentionIfNeeded(address: number): void {
    if (this.memory.isContended(address)) {
      this.tick(this.ula.contentionDelay(this.tStates));
    }
  }

  readMemory(address: number, tag: MemoryAccessTag): number {
    this.applyContentionIfNeeded(address);
    this.tick(tag === "opcode" || tag === "opcode-prefix" ? 4 : 3);
    return this.memory.read8(address);
  }

  writeMemory(address: number, value: number, _tag: MemoryAccessTag): void {
    this.applyContentionIfNeeded(address);
    this.tick(3);
    this.memory.write8(address, value);
  }

  contend(address: number, count: number): void {
    this.applyContentionIfNeeded(address);
    this.tick(count);
  }

  abstract readPort(port: number): number;
  abstract writePort(port: number, value: number): void;

  nmiPending(): boolean {
    return false;
  }

  intPending(): boolean {
    return this.tStates < this.ula.profile.interruptLength;
  }

  readInterruptDataBus(): number {
    return 0xff;
  }

  clearNmiPending(): void {}
}
