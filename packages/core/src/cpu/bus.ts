export type MemoryAccessTag = "opcode" | "opcode-prefix" | "data" | "stack";

export interface Z80Bus {
  readonly tStates: number;

  readMemory(address: number, tag: MemoryAccessTag): number;
  writeMemory(address: number, value: number, tag: MemoryAccessTag): void;

  contend(address: number, count: number): void;

  readPort(port: number): number;
  writePort(port: number, value: number): void;

  nmiPending(): boolean;
  intPending(): boolean;
  readInterruptDataBus(): number;

  clearNmiPending(): void;
}
