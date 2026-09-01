import type { MemoryDevice } from "./memoryDevice.js";

/** 128K/+2 memory map: two paged 16K ROMs at 0x0000-0x3FFF, fixed RAM bank 5 at
 * 0x4000-0x7FFF, fixed RAM bank 2 at 0x8000-0xBFFF, and a paged RAM bank at
 * 0xC000-0xFFFF, all selected by port 0x7FFD:
 *   bits 0-2: RAM bank (0-7) paged at 0xC000
 *   bit 3:    display bank, 0 = bank 5, 1 = bank 7
 *   bit 4:    ROM bank, 0 = ROM 0 (128 editor), 1 = ROM 1 (48 BASIC)
 *   bit 5:    paging disabled (set until reset) once written 1
 * Contention follows the physical RAM bank, not the address slot: odd-numbered
 * banks (1, 3, 5, 7) are contended regardless of where they're currently paged. */
export class Memory128k implements MemoryDevice {
  private readonly roms = [new Uint8Array(0x4000), new Uint8Array(0x4000)];
  private readonly banks: Uint8Array[] = Array.from({ length: 8 }, () => new Uint8Array(0x4000));
  private pagingRegister = 0;
  private pagingLocked = false;

  loadRom(index: 0 | 1, rom: Uint8Array): void {
    if (rom.length !== 0x4000) {
      throw new Error(`128K ROM ${index} must be exactly 16384 bytes, got ${rom.length}`);
    }
    this.roms[index]!.set(rom);
  }

  /** Port 0x7FFD write. No-op once the lock bit (bit 5) has been set, until reset. */
  writePagingRegister(value: number): void {
    if (this.pagingLocked) return;
    this.pagingRegister = value & 0xff;
    if (value & 0x20) this.pagingLocked = true;
  }

  reset(): void {
    this.pagingRegister = 0;
    this.pagingLocked = false;
  }

  private get romBank(): 0 | 1 {
    return (this.pagingRegister & 0x10) !== 0 ? 1 : 0;
  }

  private get pagedRamBank(): number {
    return this.pagingRegister & 0x07;
  }

  /** Which RAM bank is currently mapped at each 16K address slot (for contention
   * and, for the paged slot, memory access). */
  private bankAt(address: number): Uint8Array {
    if (address < 0x4000) return this.roms[this.romBank]!;
    if (address < 0x8000) return this.banks[5]!;
    if (address < 0xc000) return this.banks[2]!;
    return this.banks[this.pagedRamBank]!;
  }

  private bankNumberAt(address: number): number | null {
    if (address < 0x4000) return null; // ROM, never contended
    if (address < 0x8000) return 5;
    if (address < 0xc000) return 2;
    return this.pagedRamBank;
  }

  read8(address: number): number {
    const addr = address & 0xffff;
    const offset = addr & 0x3fff;
    return this.bankAt(addr)[offset]!;
  }

  write8(address: number, value: number): void {
    const addr = address & 0xffff;
    if (addr < 0x4000) return; // ROM writes are no-ops
    this.bankAt(addr)[addr & 0x3fff] = value & 0xff;
  }

  isContended(address: number): boolean {
    const bank = this.bankNumberAt(address & 0xffff);
    return bank !== null && (bank & 1) === 1;
  }

  peek8(address: number): number {
    return this.read8(address);
  }

  poke8(address: number, value: number): void {
    this.write8(address, value);
  }

  /** Direct write into a specific physical RAM bank (0-7), bypassing paging —
   * used by snapshot loaders, which know exactly which bank each block belongs to. */
  pokeBank(bankIndex: number, data: Uint8Array): void {
    this.banks[bankIndex]!.set(data.subarray(0, 0x4000));
  }

  /** The RAM bank the ULA currently reads for the display file + attributes: bank
   * 7 if port 0x7FFD bit 3 is set, bank 5 otherwise. Matches Memory48k.screenBytes'
   * convention of index 0 == address 0x4000. */
  get screenBytes(): Uint8Array {
    return this.banks[(this.pagingRegister & 0x08) !== 0 ? 7 : 5]!;
  }
}
