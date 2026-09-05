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
