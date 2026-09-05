import { RAM_48K_SIZE, ROM_PAGE_SIZE } from "./constants.js";
import type { MemoryDevice } from "./memoryDevice.js";

export class Memory48k implements MemoryDevice {
  private readonly rom = new Uint8Array(ROM_PAGE_SIZE);
  private readonly ram = new Uint8Array(RAM_48K_SIZE);

  loadRom(rom: Uint8Array): void {
    if (rom.length !== ROM_PAGE_SIZE) {
      throw new Error(`48K ROM must be exactly ${ROM_PAGE_SIZE} bytes, got ${rom.length}`);
    }
    this.rom.set(rom);
  }

  loadRam(ram: Uint8Array): void {
    this.ram.set(ram.subarray(0, RAM_48K_SIZE));
  }

  readRam(): Uint8Array {
    return this.ram;
  }

  read8(address: number): number {
    const addr = address & 0xffff;
    return addr < 0x4000 ? this.rom[addr]! : this.ram[addr - 0x4000]!;
  }

  write8(address: number, value: number): void {
    const addr = address & 0xffff;
    if (addr < 0x4000) return;
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

  get screenBytes(): Uint8Array {
    return this.ram;
  }
}
