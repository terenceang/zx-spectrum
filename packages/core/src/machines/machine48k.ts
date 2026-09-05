import { Memory48k } from "../memory/memory48k.js";
import { ULA_48K_PROFILE, tStatesPerFrame } from "../ula/timingProfile.js";
import { UlaEngine } from "../ula/ulaEngine.js";
import { BaseMachine, ROM_TRAP_LD_BYTES, ROM_TRAP_LD_SEARCH } from "./baseMachine.js";

export class Machine48k extends BaseMachine<Memory48k> {
  readonly memory = new Memory48k();
  readonly ula = new UlaEngine(ULA_48K_PROFILE, this.keyboard);
  readonly frameTStateBudget = tStatesPerFrame(ULA_48K_PROFILE);

  loadRom(rom: Uint8Array): void {
    this.memory.loadRom(rom);
  }

  protected isTapeTrapActive(): boolean {
    const pc = this.cpu.regs.pc;
    return pc === ROM_TRAP_LD_BYTES || pc === ROM_TRAP_LD_SEARCH;
  }

  readPort(port: number): number {
    const isUlaPort = (port & 0x01) === 0;
    if (isUlaPort) this.applyContentionIfNeeded(port);
    this.tick(4);
    if ((port & 0xff) === 0x1f) return this.joystick.read();
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
