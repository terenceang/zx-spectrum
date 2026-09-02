/** Real ZX Spectrum 8x5 key matrix. Each half-row is a byte, active-low (bit clear
 * = key held), matching hardware: port 0xFE reads OR-combine every row selected by
 * a 0 bit in the address's high byte, so games that scan several rows at once for
 * multi-key combos (e.g. checking two joystick-mapped keys together) see the
 * correct combined result. PC-key -> matrix mapping lives in the app, not here —
 * this only knows about the raw 8-row-by-5-bit matrix. */
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

  /** OR-combines every row selected by a 0 bit in `addressHigh`, matching the ULA's
   * partial-decode row-select behavior for port 0xFE reads. */
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
