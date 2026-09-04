import type { DskImage, DskSector } from "./dsk.js";

/** Main Status Register (MSR) bit masks for uPD765. */
export const MSR_RQM = 0x80; // Request for Master (ready for data)
export const MSR_DIO = 0x40; // Data Direction (1 = FDC -> CPU, 0 = CPU -> FDC)
export const MSR_NDM = 0x20; // Non-DMA mode (always 1 on +3)
export const MSR_CB = 0x10; // Controller Busy
export const MSR_D3B = 0x08; // FDD 3 Busy
export const MSR_D2B = 0x04; // FDD 2 Busy
export const MSR_D1B = 0x02; // FDD 1 Busy
export const MSR_D0B = 0x01; // FDD 0 Busy

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

  // Execution phase data buffer (for Read Data / Write Data)
  private executionBuffer: Uint8Array = new Uint8Array(0);
  private executionIndex = 0;
  private executionTargetSector: DskSector | null = null;
  private executionIsWrite = false;

  // Seek / Interrupt status
  private seekInterruptPending = false;
  private interruptSt0 = 0;
  private activeDrive = 0;

  // Activity tracking for UI LED
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
        msr |= MSR_DIO; // FDC -> CPU
      }
    } else if (this.phase === FdcPhase.Result) {
      msr |= MSR_CB | MSR_DIO; // FDC -> CPU
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
        // Sector finished
        this.finishReadExecution();
      }
      return b;
    }

    if (this.phase === FdcPhase.Result) {
      const b = this.resultBytes[this.resultIndex++] ?? 0;
      if (this.resultIndex >= this.resultBytes.length) {
        // Result phase complete -> back to Command phase
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
      if (this.executionTargetSector && this.executionIndex < this.executionTargetSector.data.length) {
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
      case 0x03: // Specify
        return 3;
      case 0x04: // Sense Drive Status
        return 2;
      case 0x07: // Recalibrate
        return 2;
      case 0x08: // Sense Interrupt Status
        return 1;
      case 0x0f: // Seek
        return 3;
      case 0x06: // Read Data
      case 0x05: // Write Data
        return 9;
      case 0x0a: // Read ID
        return 2;
      case 0x0d: // Format Track
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
        // Specify: SRT, HUT, HLT, ND. No result phase.
        this.phase = FdcPhase.Command;
        this.commandBytes.length = 0;
        break;
      }

      case 0x04: {
        // Sense Drive Status: cmd, unit/head
        const unit = this.commandBytes[1]! & 0x03;
        const head = (this.commandBytes[1]! >> 2) & 0x01;
        let st3 = (head << 2) | unit;
        if (this.isDriveReady()) st3 |= 0x20; // RDY
        if (this.currentCylinder === 0) st3 |= 0x10; // Track 0
        this.enterResultPhase([st3]);
        break;
      }

      case 0x07: {
        // Recalibrate: cmd, unit
        this.activeDrive = this.commandBytes[1]! & 0x03;
        this.currentCylinder = 0;
        this.seekInterruptPending = true;
        this.interruptSt0 = 0x20 | this.activeDrive; // Seek End
        this.phase = FdcPhase.Command;
        this.commandBytes.length = 0;
        break;
      }

      case 0x08: {
        // Sense Interrupt Status: returns ST0, PCN
        if (this.seekInterruptPending) {
          this.seekInterruptPending = false;
          this.enterResultPhase([this.interruptSt0, this.currentCylinder]);
        } else {
          // No interrupt pending -> return ST0 = 0x80 (invalid command)
          this.enterResultPhase([0x80]);
        }
        break;
      }

      case 0x0f: {
        // Seek: cmd, unit/head, cylinder
        this.activeDrive = this.commandBytes[1]! & 0x03;
        const targetCyl = this.commandBytes[2]!;
        this.currentCylinder = Math.min(79, targetCyl);
        this.seekInterruptPending = true;
        this.interruptSt0 = 0x20 | this.activeDrive; // Seek End
        this.phase = FdcPhase.Command;
        this.commandBytes.length = 0;
        break;
      }

      case 0x06: {
        // Read Data: [cmd, unit/head, C, H, R, N, EOT, GPL, DTL]
        const unit = this.commandBytes[1]! & 0x03;
        const head = (this.commandBytes[1]! >> 2) & 0x01;
        const c = this.commandBytes[2]!;
        const h = this.commandBytes[3]!;
        const r = this.commandBytes[4]!;
        const n = this.commandBytes[5]!;

        if (!this.isDriveReady()) {
          // Drive not ready
          this.enterResultPhase([0x48 | unit, 0x00, 0x00, c, h, r, n]);
          return;
        }

        const sector = this.disk!.getSector(this.currentCylinder, head, r);
        if (!sector) {
          // Sector not found -> ST0 = 0x40 (abnormal termination), ST1 = 0x04 (No Data)
          this.enterResultPhase([0x40 | unit, 0x04, 0x00, c, h, r, n]);
          return;
        }

        // Enter Execution Phase
        this.phase = FdcPhase.Execution;
        this.executionIsWrite = false;
        this.executionBuffer = sector.data;
        this.executionIndex = 0;
        break;
      }

      case 0x05: {
        // Write Data: [cmd, unit/head, C, H, R, N, EOT, GPL, DTL]
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
        // Read ID: [cmd, unit/head]
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
          0x00 | unit, // ST0
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
        // Unsupported or invalid command
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

    this.enterResultPhase([
      0x00 | unit, // ST0 = normal termination
      0x00, // ST1
      0x00, // ST2
      c,
      h,
      (r + 1) & 0xff, // R incremented
      n,
    ]);
  }

  private finishWriteExecution(): void {
    const unit = this.commandBytes[1]! & 0x03;
    const c = this.commandBytes[2]!;
    const h = this.commandBytes[3]!;
    const r = this.commandBytes[4]!;
    const n = this.commandBytes[5]!;

    this.enterResultPhase([
      0x00 | unit, // ST0
      0x00,
      0x00,
      c,
      h,
      (r + 1) & 0xff,
      n,
    ]);
  }

  private enterResultPhase(bytes: number[]): void {
    this.phase = FdcPhase.Result;
    this.resultBytes.length = 0;
    this.resultBytes.push(...bytes);
    this.resultIndex = 0;
  }
}
