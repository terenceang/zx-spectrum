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
