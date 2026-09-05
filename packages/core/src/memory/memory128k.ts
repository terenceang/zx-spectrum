import { ROM_PAGE_SIZE, TOTAL_RAM_128K_BANKS } from "./constants.js";
import type { MemoryDevice } from "./memoryDevice.js";

export class Memory128k implements MemoryDevice {
  private readonly roms = [new Uint8Array(ROM_PAGE_SIZE), new Uint8Array(ROM_PAGE_SIZE)];
  private readonly banks: Uint8Array[] = Array.from(
    { length: TOTAL_RAM_128K_BANKS },
    () => new Uint8Array(ROM_PAGE_SIZE),
  );
  private pagingRegister = 0;
  private pagingLocked = false;

  private readonly slotBuffers: Uint8Array[] = new Array(4);
  private readonly slotIsContended = [false, true, false, false];

  constructor() {
    this.recomputeSlots();
  }

  private recomputeSlots(): void {
    this.slotBuffers[0] = this.roms[this.romBank]!;
    this.slotBuffers[1] = this.banks[5]!;
    this.slotBuffers[2] = this.banks[2]!;
    this.slotBuffers[3] = this.banks[this.pagedRamBank]!;
    this.slotIsContended[3] = (this.pagedRamBank & 1) === 1;
  }

  loadRom(index: 0 | 1, rom: Uint8Array): void {
    if (rom.length !== ROM_PAGE_SIZE) {
      throw new Error(
        `128K ROM ${index} must be exactly ${ROM_PAGE_SIZE} bytes, got ${rom.length}`,
      );
    }
    this.roms[index]!.set(rom);
    this.recomputeSlots();
  }

  writePagingRegister(value: number): void {
    if (this.pagingLocked) return;
    this.pagingRegister = value & 0xff;
    if (value & 0x20) this.pagingLocked = true;
    this.recomputeSlots();
  }

  writePort7ffd(value: number): void {
    this.writePagingRegister(value);
  }

  reset(): void {
    this.pagingRegister = 0;
    this.pagingLocked = false;
    this.recomputeSlots();
  }

  get romBank(): 0 | 1 {
    return (this.pagingRegister & 0x10) !== 0 ? 1 : 0;
  }

  get port7ffd(): number {
    return this.pagingRegister;
  }

  private get pagedRamBank(): number {
    return this.pagingRegister & 0x07;
  }

  read8(address: number): number {
    const addr = address & 0xffff;
    return this.slotBuffers[addr >> 14]![addr & 0x3fff]!;
  }

  write8(address: number, value: number): void {
    const addr = address & 0xffff;
    if (addr < 0x4000) return;
    this.slotBuffers[addr >> 14]![addr & 0x3fff] = value & 0xff;
  }

  isContended(address: number): boolean {
    return this.slotIsContended[(address >> 14) & 0x03]!;
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
    return this.banks[(this.pagingRegister & 0x08) !== 0 ? 7 : 5]!;
  }
}
