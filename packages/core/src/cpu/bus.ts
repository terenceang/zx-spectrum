// The CPU never touches contention/timing directly — it calls this interface for
// every memory and port access, at the correct point in the instruction's T-state
// sequence, and the *machine's* implementation (which owns the T-state counter) is
// responsible for adding any ULA contention stall before returning from a read/write
// and for advancing its own clock by the correct base T-states for the access kind.
// This keeps the CPU core hardware-agnostic while still cycle-accurate when driven
// by a contention-aware bus (matches the approach used by FUSE/jsspeccy).
//
// `tag` tells the bus what kind of access this is so it can apply the right timing
// (an opcode fetch and a data read both cost 3 base T-states on real hardware, but
// only the opcode fetch increments R and only it can be an M1 interrupt-acknowledge
// cycle when the CPU is mid-INT-response).
export type MemoryAccessTag = "opcode" | "opcode-prefix" | "data" | "stack";

export interface Z80Bus {
  /** Running T-state counter for the current frame. The CPU reads this to decide
   * when to sample interrupts; it never writes it directly — every advance happens
   * as a side effect of a read/write/contend call below. */
  readonly tStates: number;

  readMemory(address: number, tag: MemoryAccessTag): number;
  writeMemory(address: number, value: number, tag: MemoryAccessTag): void;

  /** Adds `count` T-states of "address bus held, no new access" delay — used for the
   * internal cycles many opcodes spend beyond their bus accesses (e.g. the extra 5
   * T-states in `INC (HL)`, or the 2x 2T internal delays in `ADD HL,BC`). Applies ULA
   * contention if `address` falls in a contended page, exactly like a real access. */
  contend(address: number, count: number): void;

  readPort(port: number): number;
  writePort(port: number, value: number): void;

  /** True while an NMI is pending (edge-triggered — the machine clears this once the
   * CPU has acknowledged it by jumping to 0x0066). */
  nmiPending(): boolean;
  /** True while the maskable interrupt line is asserted for this T-state. On the
   * Spectrum the ULA holds INT low for ~32 T-states once per frame. */
  intPending(): boolean;
  /** Supplies the data-bus byte read during interrupt acknowledge (M1 cycle while
   * servicing a maskable interrupt). On the Spectrum the ULA always drives 0xFF. */
  readInterruptDataBus(): number;

  clearNmiPending(): void;
}
