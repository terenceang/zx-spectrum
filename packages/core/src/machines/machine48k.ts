import { Memory48k } from "../memory/memory48k.js";
import { ULA_48K_PROFILE, tStatesPerFrame } from "../ula/timingProfile.js";
import { UlaEngine } from "../ula/ulaEngine.js";
import { BaseMachine } from "./baseMachine.js";

/** Composes the Z80 core with the 48K memory map and ULA into a runnable machine,
 * and is itself the Z80Bus implementation: every CPU memory/port access flows
 * through here so contention (looked up from the ULA's timing profile) and the
 * once-per-frame maskable interrupt can be layered on without the CPU or the ULA
 * needing to know about each other. */
export class Machine48k extends BaseMachine<Memory48k> {
  readonly memory = new Memory48k();
  readonly ula = new UlaEngine(ULA_48K_PROFILE, this.keyboard);
  readonly frameTStateBudget = tStatesPerFrame(ULA_48K_PROFILE);

  loadRom(rom: Uint8Array): void {
    this.memory.loadRom(rom);
  }

  getAudioSamples(sampleCount: number, _sampleRate?: number): Float32Array {
    const beeper = this.ula.beeper.renderFrame(this.frameTStateBudget, sampleCount);
    return this.mixAudio(beeper, sampleCount);
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
}
