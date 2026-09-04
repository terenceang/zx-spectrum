import { AyChip } from "../audio/ayChip.js";
import type { DskImage } from "../disk/dsk.js";
import { Fdc765 } from "../disk/fdc765.js";
import { MemoryPlus3 } from "../memory/memoryPlus3.js";
import { ULA_PLUS3_PROFILE, tStatesPerFrame } from "../ula/timingProfile.js";
import { UlaEngine } from "../ula/ulaEngine.js";
import { BaseMachine } from "./baseMachine.js";

/** ZX Spectrum +3 machine: Z80 CPU, MemoryPlus3 (ports 0x1FFD and 0x7FFD),
 * ULA (+3 timing profile), AY-3-8912 sound chip, FDC765 floppy disk controller,
 * and TapeEdgePlayer. */
export class MachinePlus3 extends BaseMachine<MemoryPlus3> {
  readonly memory = new MemoryPlus3();
  readonly ula = new UlaEngine(ULA_PLUS3_PROFILE, this.keyboard);
  readonly ay = new AyChip();
  readonly fdc = new Fdc765();
  readonly frameTStateBudget = tStatesPerFrame(ULA_PLUS3_PROFILE);

  loadRoms(rom0: Uint8Array, rom1?: Uint8Array, rom2?: Uint8Array, rom3?: Uint8Array): void {
    if (!rom1 || !rom2 || !rom3) {
      this.memory.loadRom(0, rom0.subarray(0, 16384));
      this.memory.loadRom(1, rom0.subarray(16384, 32768));
      this.memory.loadRom(2, rom0.subarray(32768, 49152));
      this.memory.loadRom(3, rom0.subarray(49152, 65536));
      return;
    }
    this.memory.loadRom(0, rom0);
    this.memory.loadRom(1, rom1);
    this.memory.loadRom(2, rom2);
    this.memory.loadRom(3, rom3);
  }

  loadDisk(disk: DskImage): void {
    this.fdc.insertDisk(disk);
  }

  ejectDisk(): void {
    this.fdc.ejectDisk();
  }

  protected isTapeTrapActive(): boolean {
    const pc = this.cpu.regs.pc;
    return (
      (pc === 0x0556 || pc === 0x0569) &&
      !this.memory.isSpecialMode &&
      this.memory.romBank === 3
    );
  }

  override reset(): void {
    super.reset();
    this.ay.reset();
    this.memory.reset();
    this.fdc.reset();
  }

  getAudioSamples(sampleCount: number, sampleRate = 44100): Float32Array {
    const beeper = this.ula.beeper.renderFrame(this.frameTStateBudget, sampleCount);
    const ay = this.ay.renderFrame(sampleCount, sampleRate);
    return this.mixAudio(beeper, sampleCount, 0.5, ay, 0.5);
  }

  getStereoAudioSamples(sampleCount: number, sampleRate = 44100): Float32Array {
    const beeper = this.ula.beeper.renderFrame(this.frameTStateBudget, sampleCount);
    const { left, right } = this.ay.renderFrameStereo(sampleCount, sampleRate);
    return this.mixAudioStereo(beeper, sampleCount, 0.5, left, right, 0.5);
  }

  readPort(port: number): number {
    const isUlaPort = (port & 0x01) === 0;
    const isAySelectPort = (port & 0xc002) === 0xc000;
    const isFdcMsrPort = (port & 0xf002) === 0x2000;
    const isFdcDataPort = (port & 0xf002) === 0x3000;

    if (isUlaPort || isAySelectPort) {
      this.applyContentionIfNeeded(port);
    }
    this.tick(4);

    if (isAySelectPort) return this.ay.readData();
    if (isFdcMsrPort) return this.fdc.readMsr();
    if (isFdcDataPort) return this.fdc.readData();
    if (!isUlaPort) return 0xff;

    const earLevel = this.tape.levelAt(this.totalTStates);
    return this.ula.readPort((port >> 8) & 0xff, earLevel);
  }

  writePort(port: number, value: number): void {
    const isUlaPort = (port & 0x01) === 0;
    const isPort7ffd = (port & 0x8002) === 0x0000;
    const isPort1ffd = (port & 0xf002) === 0x1000;
    const isAySelectPort = (port & 0xc002) === 0xc000;
    const isAyDataPort = (port & 0xc002) === 0x8000;
    const isFdcDataPort = (port & 0xf002) === 0x3000;

    if (isUlaPort || isAySelectPort || isAyDataPort) {
      this.applyContentionIfNeeded(port);
    }
    this.tick(4);

    if (isUlaPort) this.ula.writePort(this.tStates, value);
    if (isPort7ffd) this.memory.writePort7ffd(value);
    if (isPort1ffd) {
      this.memory.writePort1ffd(value);
      this.fdc.setMotor(this.memory.diskMotorOn);
    }
    if (isAySelectPort) this.ay.selectRegister(value);
    if (isAyDataPort) this.ay.writeData(value);
    if (isFdcDataPort) this.fdc.writeData(value);
  }
}
