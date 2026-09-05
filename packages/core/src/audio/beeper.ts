import { DcBlocker } from "./dcBlocker.js";

/** Records beeper output-level edges (T-state, level) during a frame and renders
 * them to a PCM sample buffer on demand. Kept separate from UlaEngine so it's
 * independently testable and so the machine's audio mixdown step can combine it
 * with the AY chip's output (128K/+3) without either chip knowing about the other.
 *
 * NOTE: edges is cleared per frame (renderFrame), so it doesn't leak across frames.
 * Programs that toggle the beeper every T-state can create thousands of objects per
 * frame, causing minor GC pressure. A flat array would reduce this but adds complexity. */
export class Beeper {
  private edges: { tState: number; level: 0 | 1 }[] = [];
  private currentLevel: 0 | 1 = 0;
  private levelAtFrameStart: 0 | 1 = 0;
  private readonly dcBlocker = new DcBlocker();

  reset(): void {
    this.edges = [];
    this.currentLevel = 0;
    this.levelAtFrameStart = 0;
    this.dcBlocker.reset();
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
    let level: number = this.levelAtFrameStart;
    let currentT = 0;

    for (let i = 0; i < sampleCount; i++) {
      const sampleEndT = (i + 1) * tStatesPerSample;
      let accum = 0;

      while (edgeIndex < this.edges.length && this.edges[edgeIndex]!.tState < sampleEndT) {
        const edgeT = this.edges[edgeIndex]!.tState;
        if (edgeT > currentT) {
          accum += level * (edgeT - currentT);
          currentT = edgeT;
        }
        level = this.edges[edgeIndex]!.level;
        edgeIndex++;
      }

      if (sampleEndT > currentT) {
        accum += level * (sampleEndT - currentT);
        currentT = sampleEndT;
      }

      const sampleVal = accum / tStatesPerSample;
      out[i] = this.dcBlocker.process(sampleVal);
    }

    this.edges = [];
    this.levelAtFrameStart = this.currentLevel;
    return out;
  }
}
