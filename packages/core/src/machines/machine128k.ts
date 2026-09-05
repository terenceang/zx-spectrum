import { AyChip } from "../audio/ayChip.js";
import { Memory128k } from "../memory/memory128k.js";
import { ULA_128K_PROFILE, tStatesPerFrame } from "../ula/timingProfile.js";
import { UlaEngine } from "../ula/ulaEngine.js";
import { BaseMachine, ROM_TRAP_LD_BYTES, ROM_TRAP_LD_SEARCH } from "./baseMachine.js";

export class Machine128k extends BaseMachine<Memory128k> {
  readonly memory = new Memory128k();
  readonly ula = new UlaEngine(ULA_128K_PROFILE, this.keyboard);
  override readonly ay = new AyChip();
  readonly frameTStateBudget = tStatesPerFrame(ULA_128K_PROFILE);

  loadRoms(rom0: Uint8Array, rom1: Uint8Array): void {
    this.memory.loadRom(0, rom0);
    this.memory.loadRom(1, rom1);
  }

  protected isTapeTrapActive(): boolean {
    const pc = this.cpu.regs.pc;
    return (pc === ROM_TRAP_LD_BYTES || pc === ROM_TRAP_LD_SEARCH) && this.memory.romBank === 1;
  }

  override reset(): void {
    super.reset();
    this.ay.reset();
    this.memory.reset();
  }

  readPort(port: number): number {
    const isUlaPort = (port & 0x01) === 0;
    const isAySelectPort = (port & 0xc002) === 0xc000;
    if (isUlaPort || isAySelectPort) this.applyContentionIfNeeded(port);
    this.tick(4);

    if (isAySelectPort) return this.ay.readData();
    if ((port & 0xff) === 0x1f) return this.joystick.read();
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
