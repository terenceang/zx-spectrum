import { AyChip } from "../audio/ayChip.js";
import type { DskImage } from "../disk/dsk.js";
import { Fdc765 } from "../disk/fdc765.js";
import { ROM_PAGE_SIZE } from "../memory/constants.js";
import { MemoryPlus3 } from "../memory/memoryPlus3.js";
import { ULA_PLUS3_PROFILE, tStatesPerFrame } from "../ula/timingProfile.js";
import { UlaEngine } from "../ula/ulaEngine.js";
import { BaseMachine, ROM_TRAP_LD_BYTES, ROM_TRAP_LD_SEARCH } from "./baseMachine.js";

export class MachinePlus3 extends BaseMachine<MemoryPlus3> {
  readonly memory = new MemoryPlus3();
  readonly ula = new UlaEngine(ULA_PLUS3_PROFILE, this.keyboard);
  override readonly ay = new AyChip();
  readonly fdc = new Fdc765();
  readonly frameTStateBudget = tStatesPerFrame(ULA_PLUS3_PROFILE);

  loadRoms(rom0: Uint8Array, rom1?: Uint8Array, rom2?: Uint8Array, rom3?: Uint8Array): void {
    if (!rom1 || !rom2 || !rom3) {
      this.memory.loadRom(0, rom0.subarray(0, ROM_PAGE_SIZE));
      this.memory.loadRom(1, rom0.subarray(ROM_PAGE_SIZE, ROM_PAGE_SIZE * 2));
      this.memory.loadRom(2, rom0.subarray(ROM_PAGE_SIZE * 2, ROM_PAGE_SIZE * 3));
      this.memory.loadRom(3, rom0.subarray(ROM_PAGE_SIZE * 3, ROM_PAGE_SIZE * 4));
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
      (pc === ROM_TRAP_LD_BYTES || pc === ROM_TRAP_LD_SEARCH) &&
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
    if ((port & 0xff) === 0x1f) return this.joystick.read();
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
