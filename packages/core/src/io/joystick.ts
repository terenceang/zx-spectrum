/** Kempston joystick: a single byte read on port 0x1F, active-high (bit set =
 * direction/fire held) — the opposite polarity of the keyboard matrix. Sinclair,
 * Cursor, and QAOP joysticks are just keys on the real matrix and need no
 * hardware emulation; they're handled in the app's key-mapping layer instead. */
export type KempstonInput = "up" | "down" | "left" | "right" | "fire";

const BIT: Record<KempstonInput, number> = {
  right: 0x01,
  left: 0x02,
  down: 0x04,
  up: 0x08,
  fire: 0x10,
};

export class JoystickState {
  private value = 0;

  set(input: KempstonInput, down: boolean): void {
    if (down) this.value |= BIT[input];
    else this.value &= ~BIT[input] & 0xff;
  }

  read(): number {
    return this.value;
  }

  reset(): void {
    this.value = 0;
  }
}
