import { AyChip } from "../audio/ayChip.js";
import { Memory128k } from "../memory/memory128k.js";
import { ULA_128K_PROFILE, tStatesPerFrame } from "../ula/timingProfile.js";
import { UlaEngine } from "../ula/ulaEngine.js";
import { BaseMachine } from "./baseMachine.js";

/** 128K/+2 machine: same CPU/ULA/tape composition as Machine48k, but with banked
 * memory (port 0x7FFD) and an AY-3-8912 sound chip (ports 0xFFFD/0xBFFD) mixed
 * alongside the beeper. See BaseMachine for shared infrastructure. */
export class Machine128k extends BaseMachine<Memory128k> {
  readonly memory = new Memory128k();
  readonly ula = new UlaEngine(ULA_128K_PROFILE, this.keyboard);
  readonly ay = new AyChip();
  readonly frameTStateBudget = tStatesPerFrame(ULA_128K_PROFILE);

  loadRoms(rom0: Uint8Array, rom1: Uint8Array): void {
    this.memory.loadRom(0, rom0);
    this.memory.loadRom(1, rom1);
  }

  override reset(): void {
    super.reset();
    this.ay.reset();
    this.memory.reset();
  }

  /** Mixes the beeper, AY chip, and optional tape audio down to one buffer. */
  getAudioSamples(sampleCount: number, sampleRate = 44100): Float32Array {
    const beeper = this.ula.beeper.renderFrame(this.frameTStateBudget, sampleCount);
    const ay = this.ay.renderFrame(sampleCount, sampleRate);
    return this.mixAudio(beeper, sampleCount, 0.5, ay, 0.5);
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
}
