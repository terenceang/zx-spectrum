export class KeyboardState {
  private readonly rows = new Uint8Array(8).fill(0x1f);

  reset(): void {
    this.rows.fill(0x1f);
  }

  setKey(row: number, bit: number, down: boolean): void {
    const mask = 1 << (bit & 0x07);
    if (down) this.rows[row & 0x07]! &= ~mask & 0xff;
    else this.rows[row & 0x07]! |= mask;
  }

  readPort(addressHigh: number): number {
    if ((addressHigh & 0xff) === 0xff) return 0x1f;
    let result = 0x1f;
    for (let row = 0; row < 8; row++) {
      if (((addressHigh >> row) & 1) === 0) {
        result &= this.rows[row]!;
      }
    }
    return result;
  }
}
