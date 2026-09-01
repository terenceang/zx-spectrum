export interface MemoryDevice {
  read8(address: number): number;
  write8(address: number, value: number): void;
  /** True if `address` falls on a page the ULA contends (shared with video RAM
   * access), used by the machine's Z80Bus implementation to decide whether to add
   * a contention stall for this access. */
  isContended(address: number): boolean;

  /** Debug/tooling access: no contention side effects, ROM writes still no-op. */
  peek8(address: number): number;
  poke8(address: number, value: number): void;
}
