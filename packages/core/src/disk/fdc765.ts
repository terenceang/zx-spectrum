import type { DskImage, DskSector } from "./dsk.js";

export const MSR_RQM = 0x80;
export const MSR_DIO = 0x40;
export const MSR_NDM = 0x20;
export const MSR_CB = 0x10;
export const MSR_D3B = 0x08;
export const MSR_D2B = 0x04;
export const MSR_D1B = 0x02;
export const MSR_D0B = 0x01;

enum FdcPhase {
  Command,
  Execution,
  Result,
}

export class Fdc765 {
  private disk: DskImage | null = null;
  private currentCylinder = 0;
  private motorOn = false;

  private phase: FdcPhase = FdcPhase.Command;
  private readonly commandBytes: number[] = [];
  private expectedCommandBytes = 0;

  private readonly resultBytes: number[] = [];
  private resultIndex = 0;

  private executionBuffer: Uint8Array = new Uint8Array(0);
  private executionIndex = 0;
  private executionTargetSector: DskSector | null = null;
  private executionIsWrite = false;

  private seekInterruptPending = false;
  private interruptSt0 = 0;
  private activeDrive = 0;

  activity = false;

  insertDisk(disk: DskImage | null): void {
    this.disk = disk;
  }

  ejectDisk(): DskImage | null {
    const d = this.disk;
    this.disk = null;
    return d;
  }

  getDisk(): DskImage | null {
    return this.disk;
  }

  setMotor(on: boolean): void {
    this.motorOn = on;
  }

  get isMotorOn(): boolean {
    return this.motorOn;
  }

  get currentTrack(): number {
    return this.currentCylinder;
  }

  reset(): void {
    this.phase = FdcPhase.Command;
    this.commandBytes.length = 0;
    this.expectedCommandBytes = 0;
    this.resultBytes.length = 0;
    this.resultIndex = 0;
    this.executionBuffer = new Uint8Array(0);
    this.executionIndex = 0;
    this.executionTargetSector = null;
    this.executionIsWrite = false;
    this.seekInterruptPending = false;
    this.interruptSt0 = 0;
    this.activity = false;
  }

  private isDriveReady(): boolean {
    return this.disk !== null && this.motorOn;
  }

  readMsr(): number {
    let msr = MSR_NDM | MSR_RQM;

    if (this.phase === FdcPhase.Command) {
      if (this.commandBytes.length > 0) {
        msr |= MSR_CB;
      }
    } else if (this.phase === FdcPhase.Execution) {
      msr |= MSR_CB;
      if (!this.executionIsWrite) {
        msr |= MSR_DIO;
      }
    } else if (this.phase === FdcPhase.Result) {
      msr |= MSR_CB | MSR_DIO;
    }

    if (this.seekInterruptPending) {
      msr |= MSR_D0B;
    }

    return msr;
  }

  readData(): number {
    if (this.phase === FdcPhase.Execution && !this.executionIsWrite) {
      this.activity = true;
      const b = this.executionBuffer[this.executionIndex++] ?? 0;
      if (this.executionIndex >= this.executionBuffer.length) {
        this.finishReadExecution();
      }
      return b;
    }

    if (this.phase === FdcPhase.Result) {
      const b = this.resultBytes[this.resultIndex++] ?? 0;
      if (this.resultIndex >= this.resultBytes.length) {
        this.phase = FdcPhase.Command;
        this.commandBytes.length = 0;
        this.resultBytes.length = 0;
        this.activity = false;
      }
      return b;
    }

    return 0xff;
  }

  writeData(value: number): void {
    const val = value & 0xff;

    if (this.phase === FdcPhase.Execution && this.executionIsWrite) {
      this.activity = true;
      if (
        this.executionTargetSector &&
        this.executionIndex < this.executionTargetSector.data.length
      ) {
        this.executionTargetSector.data[this.executionIndex++] = val;
      }
      if (
        this.executionTargetSector &&
        this.executionIndex >= this.executionTargetSector.data.length
      ) {
        this.finishWriteExecution();
      }
      return;
    }

    if (this.phase === FdcPhase.Command) {
      this.commandBytes.push(val);
      if (this.commandBytes.length === 1) {
        this.expectedCommandBytes = this.commandLength(val);
      }

      if (this.commandBytes.length >= this.expectedCommandBytes) {
        this.executeCommand();
      }
    }
  }

  private commandLength(cmdByte: number): number {
    const opcode = cmdByte & 0x1f;
    switch (opcode) {
      case 0x03:
        return 3;
      case 0x04:
        return 2;
      case 0x07:
        return 2;
      case 0x08:
        return 1;
      case 0x0f:
        return 3;
      case 0x06:
      case 0x05:
        return 9;
      case 0x0a:
        return 2;
      case 0x0d:
        return 6;
      default:
        return 1;
    }
  }

  private executeCommand(): void {
    const cmd = this.commandBytes[0]!;
    const opcode = cmd & 0x1f;

    switch (opcode) {
      case 0x03: {
        this.phase = FdcPhase.Command;
        this.commandBytes.length = 0;
        break;
      }

      case 0x04: {
        const unit = this.commandBytes[1]! & 0x03;
        const head = (this.commandBytes[1]! >> 2) & 0x01;
        let st3 = (head << 2) | unit;
        if (this.isDriveReady()) st3 |= 0x20;
        if (this.currentCylinder === 0) st3 |= 0x10;
        this.enterResultPhase([st3]);
        break;
      }

      case 0x07: {
        this.activeDrive = this.commandBytes[1]! & 0x03;
        this.currentCylinder = 0;
        this.seekInterruptPending = true;
        this.interruptSt0 = 0x20 | this.activeDrive;
        this.phase = FdcPhase.Command;
        this.commandBytes.length = 0;
        break;
      }

      case 0x08: {
        if (this.seekInterruptPending) {
          this.seekInterruptPending = false;
          this.enterResultPhase([this.interruptSt0, this.currentCylinder]);
        } else {
          this.enterResultPhase([0x80]);
        }
        break;
      }

      case 0x0f: {
        this.activeDrive = this.commandBytes[1]! & 0x03;
        const targetCyl = this.commandBytes[2]!;
        this.currentCylinder = Math.min(79, targetCyl);
        this.seekInterruptPending = true;
        this.interruptSt0 = 0x20 | this.activeDrive;
        this.phase = FdcPhase.Command;
        this.commandBytes.length = 0;
        break;
      }

      case 0x06: {
        const unit = this.commandBytes[1]! & 0x03;
        const head = (this.commandBytes[1]! >> 2) & 0x01;
        const c = this.commandBytes[2]!;
        const h = this.commandBytes[3]!;
        const r = this.commandBytes[4]!;
        const n = this.commandBytes[5]!;

        if (!this.isDriveReady()) {
          this.enterResultPhase([0x48 | unit, 0x00, 0x00, c, h, r, n]);
          return;
        }

        const sector = this.disk!.getSector(this.currentCylinder, head, r);
        if (!sector) {
          this.enterResultPhase([0x40 | unit, 0x04, 0x00, c, h, r, n]);
          return;
        }

        this.phase = FdcPhase.Execution;
        this.executionIsWrite = false;
        this.executionBuffer = sector.data;
        this.executionIndex = 0;
        break;
      }

      case 0x05: {
        const unit = this.commandBytes[1]! & 0x03;
        const head = (this.commandBytes[1]! >> 2) & 0x01;
        const c = this.commandBytes[2]!;
        const h = this.commandBytes[3]!;
        const r = this.commandBytes[4]!;
        const n = this.commandBytes[5]!;

        if (!this.isDriveReady()) {
          this.enterResultPhase([0x48 | unit, 0x00, 0x00, c, h, r, n]);
          return;
        }

        const sector = this.disk!.getSector(this.currentCylinder, head, r);
        if (!sector) {
          this.enterResultPhase([0x40 | unit, 0x04, 0x00, c, h, r, n]);
          return;
        }

        this.phase = FdcPhase.Execution;
        this.executionIsWrite = true;
        this.executionTargetSector = sector;
        this.executionIndex = 0;
        break;
      }

      case 0x0a: {
        const unit = this.commandBytes[1]! & 0x03;
        const head = (this.commandBytes[1]! >> 2) & 0x01;
        if (!this.isDriveReady()) {
          this.enterResultPhase([0x48 | unit, 0x00, 0x00, 0, 0, 0, 0]);
          return;
        }

        const track = this.disk!.getTrack(this.currentCylinder, head);
        const firstSector = track?.sectors[0];
        if (!firstSector) {
          this.enterResultPhase([0x40 | unit, 0x04, 0x00, this.currentCylinder, head, 0, 2]);
          return;
        }

        this.enterResultPhase([
          0x00 | unit,
          firstSector.st1,
          firstSector.st2,
          firstSector.c,
          firstSector.h,
          firstSector.r,
          firstSector.n,
        ]);
        break;
      }

      default: {
        this.enterResultPhase([0x80]);
        break;
      }
    }
  }

  private finishReadExecution(): void {
    const unit = this.commandBytes[1]! & 0x03;
    const c = this.commandBytes[2]!;
    const h = this.commandBytes[3]!;
    const r = this.commandBytes[4]!;
    const n = this.commandBytes[5]!;

    this.enterResultPhase([0x00 | unit, 0x00, 0x00, c, h, (r + 1) & 0xff, n]);
  }

  private finishWriteExecution(): void {
    const unit = this.commandBytes[1]! & 0x03;
    const c = this.commandBytes[2]!;
    const h = this.commandBytes[3]!;
    const r = this.commandBytes[4]!;
    const n = this.commandBytes[5]!;

    this.enterResultPhase([0x00 | unit, 0x00, 0x00, c, h, (r + 1) & 0xff, n]);
  }

  private enterResultPhase(bytes: number[]): void {
    this.phase = FdcPhase.Result;
    this.resultBytes.length = 0;
    this.resultBytes.push(...bytes);
    this.resultIndex = 0;
  }
}
