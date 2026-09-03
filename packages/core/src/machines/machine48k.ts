import { Memory48k } from "../memory/memory48k.js";
import { ULA_48K_PROFILE, tStatesPerFrame } from "../ula/timingProfile.js";
import { UlaEngine } from "../ula/ulaEngine.js";
import { BaseMachine } from "./baseMachine.js";

/** Composes the Z80 core with the 48K memory map and ULA into a runnable machine,
 * and is itself the Z80Bus implementation: every CPU memory/port access flows
 * through here so contention (looked up from the ULA's timing profile) and the
 * once-per-frame maskable interrupt can be layered on without the CPU or the ULA
 * needing to know about each other. */
const LOAD_KEYS: Array<{ row: number; bit: number; sRow?: number; sBit?: number }> = [
  { row: 6, bit: 3 }, // J (LOAD)
  { row: 5, bit: 0, sRow: 7, sBit: 1 }, // SYMBOL SHIFT + P (")
  { row: 5, bit: 0, sRow: 7, sBit: 1 }, // SYMBOL SHIFT + P (")
  { row: 6, bit: 0 }, // ENTER
];

export class Machine48k extends BaseMachine<Memory48k> {
  readonly memory = new Memory48k();
  readonly ula = new UlaEngine(ULA_48K_PROFILE, this.keyboard);
  readonly frameTStateBudget = tStatesPerFrame(ULA_48K_PROFILE);

  private autoLoaderState: "idle" | "wait_boot" | "typing" = "idle";
  private autoLoaderTimer = 0;
  private autoLoaderKeyIndex = 0;

  loadRom(rom: Uint8Array): void {
    this.memory.loadRom(rom);
  }

  override reset(): void {
    super.reset();
    this.autoLoaderState = "idle";
    this.autoLoaderTimer = 0;
    this.autoLoaderKeyIndex = 0;
  }

  autoStartTape(): void {
    this.fastTapeLoad = true;
    this.reset();
    this.autoLoaderState = "wait_boot";
    this.autoLoaderTimer = 0;
    this.autoLoaderKeyIndex = 0;
  }

  override runFrame(): void {
    this.updateAutoLoader();
    super.runFrame();
  }

  private updateAutoLoader(): void {
    if (this.autoLoaderState === "wait_boot") {
      this.autoLoaderTimer++;
      if (this.autoLoaderTimer >= 90) {
        this.autoLoaderState = "typing";
        this.autoLoaderTimer = 0;
        this.autoLoaderKeyIndex = 0;
      }
    } else if (this.autoLoaderState === "typing") {
      const key = LOAD_KEYS[this.autoLoaderKeyIndex];
      if (!key) {
        this.autoLoaderState = "idle";
        return;
      }

      const cycle = this.autoLoaderTimer % 10;
      if (cycle === 0 && this.autoLoaderKeyIndex === LOAD_KEYS.length - 1) {
        this.playTape();
      }

      if (cycle < 6) {
        if (key.sRow !== undefined) this.keyboard.setKey(key.sRow, key.sBit!, true);
        this.keyboard.setKey(key.row, key.bit, true);
      } else {
        this.keyboard.setKey(key.row, key.bit, false);
        if (key.sRow !== undefined) this.keyboard.setKey(key.sRow, key.sBit!, false);
      }

      this.autoLoaderTimer++;
      if (this.autoLoaderTimer >= 10) {
        this.autoLoaderTimer = 0;
        this.autoLoaderKeyIndex++;
        if (this.autoLoaderKeyIndex >= LOAD_KEYS.length) {
          this.autoLoaderState = "idle";
        }
      }
    }
  }

  protected isTapeTrapActive(): boolean {
    const pc = this.cpu.regs.pc;
    return pc === 0x0556 || pc === 0x0569;
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
