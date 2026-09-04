import { ROM_PAGE_SIZE, TOTAL_RAM_128K_BANKS } from "./constants.js";
import type { MemoryDevice } from "./memoryDevice.js";

/** Four special all-RAM paging configurations (when port 0x1FFD bit 0 is set),
 * selected by bits 1-2 of port 0x1FFD. Maps slots 0..3 (0x0000, 0x4000, 0x8000, 0xC000)
 * to physical RAM bank numbers. */
const ALL_RAM_CONFIGS: readonly (readonly [number, number, number, number])[] = [
  [0, 1, 2, 3],
  [4, 5, 6, 7],
  [4, 5, 6, 3],
  [4, 7, 6, 3],
] as const;

/** Spectrum +3 memory device: 4 x 16K ROMs (ROM 0-3) and 8 x 16K RAM banks (0-7),
 * controlled by port 0x7FFD and port 0x1FFD:
 *
 * Port 0x7FFD:
 *   bits 0-2: RAM bank paged at 0xC000 (in normal mode)
 *   bit 3:    screen bank (0 = bank 5, 1 = bank 7)
 *   bit 4:    ROM selection low bit (in normal mode)
 *   bit 5:    paging lock (disables 0x7FFD and 0x1FFD writes once 1, until reset)
 *
 * Port 0x1FFD:
 *   bit 0:    paging mode: 0 = Normal mode, 1 = Special (all-RAM) mode
 *   bit 1:    special mode config bit 0 (unused in normal mode)
 *   bit 2:    normal mode: ROM selection high bit; special mode: config bit 1
 *   bit 3:    disk drive motor: 1 = on, 0 = off
 *   bit 4:    printer strobe
 *
 * Contention on the +3:
 *   Banks 4, 5, 6, and 7 are contended; banks 0, 1, 2, and 3 are uncontended.
 *   ROM is never contended. */
export class MemoryPlus3 implements MemoryDevice {
  private readonly roms = [
    new Uint8Array(ROM_PAGE_SIZE),
    new Uint8Array(ROM_PAGE_SIZE),
    new Uint8Array(ROM_PAGE_SIZE),
    new Uint8Array(ROM_PAGE_SIZE),
  ];
  private readonly banks: Uint8Array[] = Array.from(
    { length: TOTAL_RAM_128K_BANKS },
    () => new Uint8Array(ROM_PAGE_SIZE),
  );

  private paging7ffd = 0;
  private paging1ffd = 0;
  private pagingLocked = false;

  loadRom(index: 0 | 1 | 2 | 3, rom: Uint8Array): void {
    if (rom.length !== ROM_PAGE_SIZE) {
      throw new Error(`+3 ROM ${index} must be exactly ${ROM_PAGE_SIZE} bytes, got ${rom.length}`);
    }
    this.roms[index]!.set(rom);
  }

  writePort7ffd(value: number): void {
    if (this.pagingLocked) return;
    this.paging7ffd = value & 0xff;
    if (value & 0x20) this.pagingLocked = true;
  }

  writePort1ffd(value: number): void {
    if (this.pagingLocked) return;
    this.paging1ffd = value & 0xff;
  }

  reset(): void {
    this.paging7ffd = 0;
    this.paging1ffd = 0;
    this.pagingLocked = false;
  }

  get port7ffd(): number {
    return this.paging7ffd;
  }

  get port1ffd(): number {
    return this.paging1ffd;
  }

  get isPagingLocked(): boolean {
    return this.pagingLocked;
  }

  get isSpecialMode(): boolean {
    return (this.paging1ffd & 0x01) !== 0;
  }

  get romBank(): 0 | 1 | 2 | 3 {
    const high = (this.paging1ffd & 0x04) >> 1; // bit 2 -> bit 1
    const low = (this.paging7ffd & 0x10) >> 4; // bit 4 -> bit 0
    return (high | low) as 0 | 1 | 2 | 3;
  }

  get diskMotorOn(): boolean {
    return (this.paging1ffd & 0x08) !== 0;
  }

  get printerStrobe(): boolean {
    return (this.paging1ffd & 0x10) !== 0;
  }

  private bankNumberAt(address: number): number | null {
    const slot = (address >> 14) & 0x03;
    if (this.isSpecialMode) {
      const config = (this.paging1ffd >> 1) & 0x03;
      return ALL_RAM_CONFIGS[config]![slot]!;
    }

    switch (slot) {
      case 0:
        return null; // ROM
      case 1:
        return 5;
      case 2:
        return 2;
      case 3:
        return this.paging7ffd & 0x07;
      default:
        return null;
    }
  }

  private targetBufferAt(address: number): { buffer: Uint8Array; isRom: boolean } {
    const slot = (address >> 14) & 0x03;
    if (this.isSpecialMode) {
      const config = (this.paging1ffd >> 1) & 0x03;
      const bankIndex = ALL_RAM_CONFIGS[config]![slot]!;
      return { buffer: this.banks[bankIndex]!, isRom: false };
    }

    switch (slot) {
      case 0:
        return { buffer: this.roms[this.romBank]!, isRom: true };
      case 1:
        return { buffer: this.banks[5]!, isRom: false };
      case 2:
        return { buffer: this.banks[2]!, isRom: false };
      case 3:
      default:
        return { buffer: this.banks[this.paging7ffd & 0x07]!, isRom: false };
    }
  }

  read8(address: number): number {
    const addr = address & 0xffff;
    const { buffer } = this.targetBufferAt(addr);
    return buffer[addr & 0x3fff]!;
  }

  write8(address: number, value: number): void {
    const addr = address & 0xffff;
    const { buffer, isRom } = this.targetBufferAt(addr);
    if (isRom) return;
    buffer[addr & 0x3fff] = value & 0xff;
  }

  isContended(address: number): boolean {
    const bank = this.bankNumberAt(address & 0xffff);
    return bank !== null && bank >= 4;
  }

  peek8(address: number): number {
    return this.read8(address);
  }

  poke8(address: number, value: number): void {
    this.write8(address, value);
  }

  pokeBank(bankIndex: number, data: Uint8Array): void {
    this.banks[bankIndex]!.set(data.subarray(0, ROM_PAGE_SIZE));
  }

  peekBank(bankIndex: number): Uint8Array {
    return this.banks[bankIndex]!;
  }

  get screenBytes(): Uint8Array {
    return this.banks[(this.paging7ffd & 0x08) !== 0 ? 7 : 5]!;
  }
}
