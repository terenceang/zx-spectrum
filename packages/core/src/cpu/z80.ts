import type { Z80Bus } from "./bus.js";
import { Flag } from "./flags.js";
import { RegIndex, Registers, REGISTERS_BYTE_LENGTH, WORDS_LENGTH } from "./registers.js";
import type { IndexRegister, OpcodeTable } from "./types.js";
import { buildBaseTable } from "./opcodes/baseTable.js";
import { buildCbTable } from "./opcodes/cbTable.js";
import { buildEdTable } from "./opcodes/edTable.js";
import { buildIndexTable } from "./opcodes/indexTable.js";
import { buildIndexCbTable } from "./opcodes/indexCbTable.js";

export type InterruptMode = 0 | 1 | 2;

/** Flat, plain-data snapshot of everything the CPU needs to resume execution
 * mid-frame — used for save-states. No closures, no class instances beyond typed
 * arrays, so it round-trips through structured clone / ArrayBuffer transfer cleanly. */
export interface CpuState {
  registerBytes: Uint8Array;
  registerWords: Uint16Array;
  iff1: boolean;
  iff2: boolean;
  im: InterruptMode;
  halted: boolean;
}

export class Z80 {
  readonly regs = new Registers();

  iff1 = false;
  iff2 = false;
  im: InterruptMode = 0;
  halted = false;
  /** Set by EI: the classic "one more instruction" delay before a maskable
   * interrupt can be accepted again. NMI is not affected by this delay. */
  interruptsSuppressedForOneStep = false;

  private readonly baseTable: OpcodeTable = buildBaseTable();
  private readonly cbTable: OpcodeTable = buildCbTable();
  private readonly edTable: OpcodeTable = buildEdTable();
  private readonly ixTable: OpcodeTable = buildIndexTable("ix");
  private readonly iyTable: OpcodeTable = buildIndexTable("iy");
  private readonly ixCbTable: OpcodeTable = buildIndexCbTable("ix");
  private readonly iyCbTable: OpcodeTable = buildIndexCbTable("iy");

  /** Which index register (if any) the instruction currently being decoded/executed
   * is using — read by opcode handlers generated for the index tables so a single
   * handler body can serve both IX and IY variants. */
  currentIndex: IndexRegister | null = null;
  /** Displacement byte for the instruction currently executing, valid only while
   * `currentIndex` is set and only meaningful for handlers that use (index+d). */
  displacement = 0;

  constructor(public readonly bus: Z80Bus) {
    this.regs.reset();
  }

  reset(): void {
    this.regs.reset();
    this.iff1 = false;
    this.iff2 = false;
    this.im = 0;
    this.halted = false;
    this.currentIndex = null;
    this.interruptsSuppressedForOneStep = false;
  }

  getState(): CpuState {
    return {
      registerBytes: this.regs.bytes.slice(),
      registerWords: this.regs.words.slice(),
      iff1: this.iff1,
      iff2: this.iff2,
      im: this.im,
      halted: this.halted,
    };
  }

  setState(state: CpuState): void {
    this.regs.bytes.set(state.registerBytes.subarray(0, REGISTERS_BYTE_LENGTH));
    this.regs.words.set(state.registerWords.subarray(0, WORDS_LENGTH));
    this.iff1 = state.iff1;
    this.iff2 = state.iff2;
    this.im = state.im;
    this.halted = state.halted;
  }

  // ---- flags -------------------------------------------------------------

  get f(): number {
    return this.regs.bytes[RegIndex.F]!;
  }
  set f(value: number) {
    this.regs.bytes[RegIndex.F] = value & 0xff;
  }

  getFlag(mask: Flag): boolean {
    return (this.f & mask) !== 0;
  }

  setFlag(mask: Flag, value: boolean): void {
    this.f = value ? this.f | mask : this.f & ~mask;
  }

  // ---- register-file (R) --------------------------------------------------

  incrementR(): void {
    const r = this.regs.bytes[RegIndex.R]!;
    this.regs.bytes[RegIndex.R] = (r & 0x80) | ((r + 1) & 0x7f);
  }

  // ---- memory / port access -----------------------------------------------

  /** Fetch the next byte at PC as an opcode/prefix byte: increments R (M1 cycle). */
  fetchOpcodeByte(): number {
    const addr = this.regs.pc;
    const value = this.bus.readMemory(addr, "opcode");
    this.regs.pc = (addr + 1) & 0xffff;
    this.incrementR();
    return value;
  }

  /** Fetch the next byte at PC as instruction data (immediate operand) — no R
   * increment, not an M1 cycle. */
  fetchOperandByte(): number {
    const addr = this.regs.pc;
    const value = this.bus.readMemory(addr, "data");
    this.regs.pc = (addr + 1) & 0xffff;
    return value;
  }

  fetchOperandWord(): number {
    const low = this.fetchOperandByte();
    const high = this.fetchOperandByte();
    return (high << 8) | low;
  }

  /** Signed displacement byte for (IX+d)/(IY+d) addressing. */
  fetchDisplacement(): number {
    const value = this.fetchOperandByte();
    return value >= 0x80 ? value - 0x100 : value;
  }

  readByte(address: number): number {
    return this.bus.readMemory(address & 0xffff, "data");
  }

  writeByte(address: number, value: number): void {
    this.bus.writeMemory(address & 0xffff, value & 0xff, "data");
  }

  readWord(address: number): number {
    const low = this.readByte(address);
    const high = this.readByte((address + 1) & 0xffff);
    return (high << 8) | low;
  }

  writeWord(address: number, value: number): void {
    this.writeByte(address, value & 0xff);
    this.writeByte((address + 1) & 0xffff, (value >> 8) & 0xff);
  }

  contend(address: number, count: number): void {
    this.bus.contend(address, count);
  }

  readPort(port: number): number {
    return this.bus.readPort(port);
  }

  writePort(port: number, value: number): void {
    this.bus.writePort(port, value & 0xff);
  }

  push(value: number): void {
    let sp = (this.regs.sp - 1) & 0xffff;
    this.bus.writeMemory(sp, (value >> 8) & 0xff, "stack");
    sp = (sp - 1) & 0xffff;
    this.bus.writeMemory(sp, value & 0xff, "stack");
    this.regs.sp = sp;
  }

  pop(): number {
    let sp = this.regs.sp;
    const low = this.bus.readMemory(sp, "stack");
    sp = (sp + 1) & 0xffff;
    const high = this.bus.readMemory(sp, "stack");
    sp = (sp + 1) & 0xffff;
    this.regs.sp = sp;
    return (high << 8) | low;
  }

  // ---- main loop ------------------------------------------------------------

  /** Executes exactly one instruction (or one HALT-refresh cycle, or one interrupt
   * response), including any pending NMI/INT check beforehand. Callers (the machine's
   * frame loop) call this repeatedly until `bus.tStates` reaches the frame's T-state
   * budget. */
  step(): void {
    if (this.bus.nmiPending()) {
      this.serviceNmi();
      return;
    }

    if (this.interruptsSuppressedForOneStep) {
      // The instruction right after EI always runs with maskable interrupts still
      // held off, even if the ULA is asserting INT this T-state.
      this.interruptsSuppressedForOneStep = false;
      if (this.halted) {
        this.incrementR();
        this.bus.contend(this.regs.pc, 4);
      } else {
        this.executeOne();
      }
      return;
    }

    if (this.halted) {
      // HALT repeatedly performs an internal NOP-equivalent fetch cycle at the
      // current PC until an interrupt arrives, without advancing PC.
      this.incrementR();
      this.bus.contend(this.regs.pc, 4);
      if (this.bus.intPending() && this.iff1) {
        this.serviceMaskableInterrupt();
      }
      return;
    }

    if (this.bus.intPending() && this.iff1) {
      this.serviceMaskableInterrupt();
      return;
    }

    this.executeOne();
  }

  private executeOne(): void {
    this.currentIndex = null;
    let opcode = this.fetchOpcodeByte();

    // DD/FD prefixes may repeat (e.g. DD DD 21 nn nn) — only the last one before a
    // non-prefix byte takes effect; each repeated prefix still costs a fetch cycle.
    while (opcode === 0xdd || opcode === 0xfd) {
      this.currentIndex = opcode === 0xdd ? "ix" : "iy";
      opcode = this.fetchOpcodeByte();
    }

    if (opcode === 0xcb) {
      if (this.currentIndex) {
        // DD/FD CB dd oo: displacement comes before the opcode byte, and neither
        // is a genuine M1 fetch (no R increment for either).
        this.displacement = this.fetchDisplacement();
        const cbOpcode = this.fetchOperandByte();
        const table = this.currentIndex === "ix" ? this.ixCbTable : this.iyCbTable;
        table[cbOpcode]!(this);
      } else {
        const cbOpcode = this.fetchOpcodeByte();
        this.cbTable[cbOpcode]!(this);
      }
      return;
    }

    if (opcode === 0xed) {
      const edOpcode = this.fetchOpcodeByte();
      this.edTable[edOpcode]!(this);
      return;
    }

    if (this.currentIndex) {
      const table = this.currentIndex === "ix" ? this.ixTable : this.iyTable;
      table[opcode]!(this);
      return;
    }

    this.baseTable[opcode]!(this);
  }

  private serviceNmi(): void {
    this.halted = false;
    this.iff2 = this.iff1;
    this.iff1 = false;
    this.incrementR();
    this.bus.contend(this.regs.pc, 5);
    this.push(this.regs.pc);
    this.regs.pc = 0x0066;
    this.regs.memptr = 0x0066;
    this.bus.clearNmiPending();
  }

  private serviceMaskableInterrupt(): void {
    this.halted = false;
    this.iff1 = false;
    this.iff2 = false;
    this.incrementR();
    const dataBusByte = this.bus.readInterruptDataBus();
    this.bus.contend(this.regs.pc, 7);

    switch (this.im) {
      case 0: {
        // The device places an instruction byte on the bus. On the Spectrum the ULA
        // always drives 0xFF (RST 38h), but model it generically: any RST-shaped
        // byte (0xC7 + 8*n, i.e. 0b11xxx111) jumps to its RST vector.
        this.push(this.regs.pc);
        this.regs.pc = dataBusByte & 0x38;
        this.regs.memptr = this.regs.pc;
        break;
      }
      case 1: {
        this.push(this.regs.pc);
        this.regs.pc = 0x0038;
        this.regs.memptr = 0x0038;
        break;
      }
      case 2: {
        this.push(this.regs.pc);
        const vectorAddr = ((this.regs.bytes[RegIndex.I]! << 8) | dataBusByte) & 0xffff;
        this.regs.pc = this.readWord(vectorAddr);
        this.regs.memptr = this.regs.pc;
        break;
      }
    }
  }
}
