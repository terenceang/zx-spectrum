import { AyChip } from "../audio/ayChip.js";
import type { MemoryAccessTag, Z80Bus } from "../cpu/bus.js";
import { Z80 } from "../cpu/z80.js";
import { KeyboardState } from "../io/keyboard.js";
import { TapeEdgePlayer } from "../loaders/tapePlayer.js";
import type { TapePulseSequence } from "../loaders/tapePulse.js";
import { Memory128k } from "../memory/memory128k.js";
import { ULA_128K_PROFILE, tStatesPerFrame } from "../ula/timingProfile.js";
import { UlaEngine } from "../ula/ulaEngine.js";

/** 128K/+2 machine: same CPU/ULA/tape composition as Machine48k, but with banked
 * memory (port 0x7FFD) and an AY-3-8912 sound chip (ports 0xFFFD/0xBFFD) mixed
 * alongside the beeper. See Machine48k for the shared design rationale. */
export class Machine128k implements Z80Bus {
  readonly cpu: Z80;
  readonly memory = new Memory128k();
  readonly keyboard = new KeyboardState();
  readonly ula = new UlaEngine(ULA_128K_PROFILE, this.keyboard);
  readonly ay = new AyChip();
  readonly tape = new TapeEdgePlayer();
  tapeSoundEnabled = true;

  tStates = 0;
  totalTStates = 0;
  private frameStartTotalT = 0;
  private readonly frameTStateBudget = tStatesPerFrame(ULA_128K_PROFILE);

  constructor() {
    this.cpu = new Z80(this);
  }

  loadRoms(rom0: Uint8Array, rom1: Uint8Array): void {
    this.memory.loadRom(0, rom0);
    this.memory.loadRom(1, rom1);
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
    this.ay.reset();
    this.memory.reset();
    this.tape.stop();
    this.tStates = 0;
  }

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

  /** Mixes the beeper, AY chip, and optional tape audio down to one buffer. */
  getAudioSamples(sampleCount: number, sampleRate: number): Float32Array {
    const beeper = this.ula.beeper.renderFrame(this.frameTStateBudget, sampleCount);
    const ay = this.ay.renderFrame(sampleCount, sampleRate);
    const tapeAudio =
      this.tapeSoundEnabled && this.tape.isPlaying()
        ? this.tape.renderFrameAudio(this.frameStartTotalT, this.frameTStateBudget, sampleCount)
        : null;
    const out = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      const tapeVal = tapeAudio ? tapeAudio[i]! * 0.4 : 0;
      out[i] = Math.max(-1, Math.min(1, beeper[i]! * 0.5 + ay[i]! * 0.5 + tapeVal));
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
    const isAySelectPort = (port & 0xc002) === 0xc000;
    if (isUlaPort || isAySelectPort) this.applyContentionIfNeeded(port);
    this.tick(4);

    if (isAySelectPort) return this.ay.readData();
    if (!isUlaPort) return 0xff;
    const earLevel = this.tape.levelAt(this.totalTStates);
    return this.ula.readPort((port >> 8) & 0xff, earLevel);
  }

  writePort(port: number, value: number): void {
    const isUlaPort = (port & 0x01) === 0;
    const isPagingPort = (port & 0x8002) === 0;
    const isAySelectPort = (port & 0xc002) === 0xc000;
    const isAyDataPort = (port & 0xc002) === 0x8000;
    if (isUlaPort || isAySelectPort || isAyDataPort) this.applyContentionIfNeeded(port);
    this.tick(4);

    if (isUlaPort) this.ula.writePort(this.tStates, value);
    if (isPagingPort) this.memory.writePagingRegister(value);
    if (isAySelectPort) this.ay.selectRegister(value);
    if (isAyDataPort) this.ay.writeData(value);
  }

  nmiPending(): boolean {
    return false; // no NMI source modeled on the 48K/128K yet
  }

  intPending(): boolean {
    return this.tStates < this.ula.profile.interruptLength;
  }

  readInterruptDataBus(): number {
    return 0xff;
  }

  clearNmiPending(): void {}
}
