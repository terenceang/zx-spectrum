import type { MemoryAccessTag, Z80Bus } from "../cpu/bus.js";
import { Z80 } from "../cpu/z80.js";
import { KeyboardState } from "../io/keyboard.js";
import { TapeEdgePlayer } from "../loaders/tapePlayer.js";
import type { TapePulseSequence } from "../loaders/tapePulse.js";
import { Memory48k } from "../memory/memory48k.js";
import { ULA_48K_PROFILE, tStatesPerFrame } from "../ula/timingProfile.js";
import { UlaEngine } from "../ula/ulaEngine.js";

/** Composes the Z80 core with the 48K memory map and ULA into a runnable machine,
 * and is itself the Z80Bus implementation: every CPU memory/port access flows
 * through here so contention (looked up from the ULA's timing profile) and the
 * once-per-frame maskable interrupt can be layered on without the CPU or the ULA
 * needing to know about each other. */
export class Machine48k implements Z80Bus {
  readonly cpu: Z80;
  readonly memory = new Memory48k();
  readonly keyboard = new KeyboardState();
  readonly ula = new UlaEngine(ULA_48K_PROFILE, this.keyboard);
  readonly tape = new TapeEdgePlayer();
  tapeSoundEnabled = true;

  /** Resets every frame — used for contention/interrupt timing within a frame. */
  tStates = 0;
  /** Never resets — tape playback timing spans many frames, so it needs a clock
   * that doesn't restart each frame the way `tStates` does. */
  totalTStates = 0;
  private frameStartTotalT = 0;
  private readonly frameTStateBudget = tStatesPerFrame(ULA_48K_PROFILE);

  constructor() {
    this.cpu = new Z80(this);
  }

  loadRom(rom: Uint8Array): void {
    this.memory.loadRom(rom);
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

  /** Runs the CPU until this frame's T-state budget is spent, recording border
   * changes and beeper edges for subsequent rendering. */
  runFrame(): void {
    this.ula.beginFrame();
    this.tStates = 0;
    this.frameStartTotalT = this.totalTStates;
    let steps = 0;
    while (this.tStates < this.frameTStateBudget) {
      this.cpu.step();
      if (++steps > 100_000) {
        throw new Error("runFrame: exceeded 100 000 steps — possible infinite loop");
      }
    }
  }

  getFrameBuffer(): { pixels: Uint8Array; width: number; height: number } {
    return this.ula.renderFrame(this.memory);
  }

  getAudioSamples(sampleCount: number): Float32Array {
    const beeper = this.ula.beeper.renderFrame(this.frameTStateBudget, sampleCount);
    if (!this.tapeSoundEnabled || !this.tape.isPlaying()) {
      return beeper;
    }
    const tapeAudio = this.tape.renderFrameAudio(
      this.frameStartTotalT,
      this.frameTStateBudget,
      sampleCount,
    );
    const out = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      out[i] = Math.max(-1, Math.min(1, beeper[i]! + tapeAudio[i]! * 0.4));
    }
    return out;
  }

  // ---- Z80Bus ---------------------------------------------------------------

  private tick(count: number): void {
    this.tStates += count;
    this.totalTStates += count;
  }

  private applyContentionIfNeeded(address: number): void {
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

  readPort(port: number): number {
    const isUlaPort = (port & 0x01) === 0;
    if (isUlaPort) this.applyContentionIfNeeded(port);
    this.tick(4);
    if (!isUlaPort) return 0xff;
    const earLevel = this.tape.levelAt(this.totalTStates);
    return this.ula.readPort((port >> 8) & 0xff, earLevel);
  }

  writePort(port: number, value: number): void {
    const isUlaPort = (port & 0x01) === 0;
    if (isUlaPort) this.applyContentionIfNeeded(port);
    this.tick(4);
    if (isUlaPort) this.ula.writePort(this.tStates, value);
  }

  nmiPending(): boolean {
    return false; // no NMI source modeled on the 48K/128K yet
  }

  intPending(): boolean {
    return this.tStates < this.ula.profile.interruptLength;
  }

  readInterruptDataBus(): number {
    return 0xff; // the Spectrum ULA always drives 0xFF during interrupt acknowledge
  }

  clearNmiPending(): void {}
}
