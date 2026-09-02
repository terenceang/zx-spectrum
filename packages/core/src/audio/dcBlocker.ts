/** Single-pole IIR DC-blocking high-pass filter: y[n] = x[n] - x[n-1] + R * y[n-1],
 * clamped to [-1, 1]. Cutoff is ~35 Hz at 44.1 kHz with default R = 0.995.
 * Shared across beeper and tape audio rendering. */
export class DcBlocker {
  private prevIn = 0;
  private prevOut = 0;

  constructor(readonly r = 0.995) {}

  reset(): void {
    this.prevIn = 0;
    this.prevOut = 0;
  }

  process(raw: number): number {
    const y = raw - this.prevIn + this.r * this.prevOut;
    this.prevIn = raw;
    this.prevOut = y;
    return Math.max(-1, Math.min(1, y));
  }
}
