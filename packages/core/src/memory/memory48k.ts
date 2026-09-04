import { RAM_48K_SIZE, ROM_PAGE_SIZE } from "./constants.js";
import type { MemoryDevice } from "./memoryDevice.js";

/** 48K Spectrum memory map: 16K ROM at 0x0000-0x3FFF, 48K RAM at 0x4000-0xFFFF.
 * The lower 16K of RAM (0x4000-0x7FFF, holding the display file and attributes) is
 * the ULA-contended page; the rest is not. */
export class Memory48k implements MemoryDevice {
  private readonly rom = new Uint8Array(ROM_PAGE_SIZE);
  private readonly ram = new Uint8Array(RAM_48K_SIZE);

  loadRom(rom: Uint8Array): void {
    if (rom.length !== ROM_PAGE_SIZE) {
      throw new Error(`48K ROM must be exactly ${ROM_PAGE_SIZE} bytes, got ${rom.length}`);
    }
    this.rom.set(rom);
  }

  /** Loads RAM image (0x4000-0xFFFF). If shorter than 49152 bytes, the remainder
   * is zero-filled. If longer, only the first 49152 bytes are used. */
  loadRam(ram: Uint8Array): void {
    this.ram.set(ram.subarray(0, RAM_48K_SIZE));
  }

  /** Full RAM image (0x4000-0xFFFF), 49152 bytes — snapshot saving reads this back.
   * WARNING: returns a mutable reference to the internal buffer; copy before mutating
   * elsewhere. */
  readRam(): Uint8Array {
    return this.ram;
  }

  read8(address: number): number {
    const addr = address & 0xffff;
    return addr < 0x4000 ? this.rom[addr]! : this.ram[addr - 0x4000]!;
  }

  write8(address: number, value: number): void {
    const addr = address & 0xffff;
    if (addr < 0x4000) return; // ROM writes are no-ops
    this.ram[addr - 0x4000] = value & 0xff;
  }

  isContended(address: number): boolean {
    const addr = address & 0xffff;
    return addr >= 0x4000 && addr < 0x8000;
  }

  peek8(address: number): number {
    return this.read8(address);
  }

  poke8(address: number, value: number): void {
    const addr = address & 0xffff;
    if (addr < 0x4000) return;
    this.ram[addr - 0x4000] = value & 0xff;
  }

  /** Direct access to the display-file + attribute RAM (0x4000-0x5AFF) for the ULA
   * renderer — avoids going through read8's bounds check per pixel.
   * WARNING: Returns a mutable reference to the internal RAM buffer. Callers must
   * not write to the returned view — use write8/poke8 for writes. */
  get screenBytes(): Uint8Array {
    return this.ram;
  }
}
