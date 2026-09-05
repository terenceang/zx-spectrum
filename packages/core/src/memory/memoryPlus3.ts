import { ROM_PAGE_SIZE, TOTAL_RAM_128K_BANKS } from "./constants.js";
import type { MemoryDevice } from "./memoryDevice.js";

const ALL_RAM_CONFIGS: readonly (readonly [number, number, number, number])[] = [
  [0, 1, 2, 3],
  [4, 5, 6, 7],
  [4, 5, 6, 3],
  [4, 7, 6, 3],
] as const;

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

  private readonly slotBuffers: Uint8Array[] = new Array(4);
  private readonly slotIsRom = [true, false, false, false];
  private readonly slotIsContended = [false, true, false, false];

  constructor() {
    this.recomputeSlots();
  }

  private recomputeSlots(): void {
    if (this.isSpecialMode) {
      const config = (this.paging1ffd >> 1) & 0x03;
      const bankConfig = ALL_RAM_CONFIGS[config]!;
      for (let slot = 0; slot < 4; slot++) {
        const bank = bankConfig[slot]!;
        this.slotBuffers[slot] = this.banks[bank]!;
        this.slotIsRom[slot] = false;
        this.slotIsContended[slot] = bank >= 4;
      }
      return;
    }

    this.slotBuffers[0] = this.roms[this.romBank]!;
    this.slotIsRom[0] = true;
    this.slotIsContended[0] = false;

    this.slotBuffers[1] = this.banks[5]!;
    this.slotIsRom[1] = false;
    this.slotIsContended[1] = true;

    this.slotBuffers[2] = this.banks[2]!;
    this.slotIsRom[2] = false;
    this.slotIsContended[2] = false;

    const pagedBank = this.paging7ffd & 0x07;
    this.slotBuffers[3] = this.banks[pagedBank]!;
    this.slotIsRom[3] = false;
    this.slotIsContended[3] = pagedBank >= 4;
  }

  loadRom(index: 0 | 1 | 2 | 3, rom: Uint8Array): void {
    if (rom.length !== ROM_PAGE_SIZE) {
      throw new Error(`+3 ROM ${index} must be exactly ${ROM_PAGE_SIZE} bytes, got ${rom.length}`);
    }
    this.roms[index]!.set(rom);
    this.recomputeSlots();
  }

  writePort7ffd(value: number): void {
    if (this.pagingLocked) return;
    this.paging7ffd = value & 0xff;
    if (value & 0x20) this.pagingLocked = true;
    this.recomputeSlots();
  }

  writePagingRegister(value: number): void {
    this.writePort7ffd(value);
  }

  writePort1ffd(value: number): void {
    if (this.pagingLocked) return;
    this.paging1ffd = value & 0xff;
    this.recomputeSlots();
  }

  reset(): void {
    this.paging7ffd = 0;
    this.paging1ffd = 0;
    this.pagingLocked = false;
    this.recomputeSlots();
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
    const high = (this.paging1ffd & 0x04) >> 1;
    const low = (this.paging7ffd & 0x10) >> 4;
    return (high | low) as 0 | 1 | 2 | 3;
  }

  get diskMotorOn(): boolean {
    return (this.paging1ffd & 0x08) !== 0;
  }

  get printerStrobe(): boolean {
    return (this.paging1ffd & 0x10) !== 0;
  }

  read8(address: number): number {
    const addr = address & 0xffff;
    return this.slotBuffers[addr >> 14]![addr & 0x3fff]!;
  }

  write8(address: number, value: number): void {
    const addr = address & 0xffff;
    const slot = addr >> 14;
    if (this.slotIsRom[slot]) return;
    this.slotBuffers[slot]![addr & 0x3fff] = value & 0xff;
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
    return this.banks[(this.paging7ffd & 0x08) !== 0 ? 7 : 5]!;
  }
}
