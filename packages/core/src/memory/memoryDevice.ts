export interface MemoryDevice {
  read8(address: number): number;
  write8(address: number, value: number): void;
  isContended(address: number): boolean;

  peek8(address: number): number;
  poke8(address: number, value: number): void;

  readonly screenBytes: Uint8Array;
}
