/** Records beeper output-level edges (T-state, level) during a frame and renders
 * them to a PCM sample buffer on demand. Kept separate from UlaEngine so it's
 * independently testable and so the machine's audio mixdown step can combine it
 * with the AY chip's output (128K/+3) without either chip knowing about the other. */
export class Beeper {
  private edges: { tState: number; level: 0 | 1 }[] = [];
  private currentLevel: 0 | 1 = 0;
  private levelAtFrameStart: 0 | 1 = 0;
  private dcPrevIn = 0;
  private dcPrevOut = 0;

  reset(): void {
    this.edges = [];
    this.currentLevel = 0;
    this.levelAtFrameStart = 0;
    this.dcPrevIn = 0;
    this.dcPrevOut = 0;
  }

  /** Called on every write to port 0xFE's beeper bit (bit 4). */
  setLevel(tState: number, level: 0 | 1): void {
    if (level === this.currentLevel) return;
    this.currentLevel = level;
    this.edges.push({ tState, level });
  }

  /** Renders this frame's recorded edges to `sampleCount` samples spanning
   * `[0, tStatesInFrame)`, applying a DC-blocking high-pass filter (cutoff ~35 Hz)
   * so silence idles at 0.0, eliminating DC offset and buffer-underrun buzzing.
   * Output is in [-1, 1]. */
  renderFrame(tStatesInFrame: number, sampleCount: number): Float32Array {
    const out = new Float32Array(sampleCount);
    const tStatesPerSample = tStatesInFrame / sampleCount;
    let edgeIndex = 0;
    let level = this.levelAtFrameStart;
    const R = 0.995;

    for (let i = 0; i < sampleCount; i++) {
      const sampleEndT = (i + 1) * tStatesPerSample;
      while (edgeIndex < this.edges.length && this.edges[edgeIndex]!.tState < sampleEndT) {
        level = this.edges[edgeIndex]!.level;
        edgeIndex++;
      }
      const raw = level ? 1 : 0;
      const y = raw - this.dcPrevIn + R * this.dcPrevOut;
      this.dcPrevIn = raw;
      this.dcPrevOut = y;
      out[i] = Math.max(-1, Math.min(1, y));
    }

    this.edges = [];
    this.levelAtFrameStart = this.currentLevel;
    return out;
  }
}
