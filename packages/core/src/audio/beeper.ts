import { DcBlocker } from "./dcBlocker.js";

export class Beeper {
  private edgeTStates = new Float64Array(2048);
  private edgeLevels = new Uint8Array(2048);
  private edgeCount = 0;
  private currentLevel: 0 | 1 = 0;
  private levelAtFrameStart: 0 | 1 = 0;
  private readonly dcBlocker = new DcBlocker();

  reset(): void {
    this.edgeCount = 0;
    this.currentLevel = 0;
    this.levelAtFrameStart = 0;
    this.dcBlocker.reset();
  }

  setLevel(tState: number, level: 0 | 1): void {
    if (level === this.currentLevel) return;
    this.currentLevel = level;
    if (this.edgeCount >= this.edgeTStates.length) {
      const newCapacity = this.edgeTStates.length * 2;
      const newT = new Float64Array(newCapacity);
      const newL = new Uint8Array(newCapacity);
      newT.set(this.edgeTStates);
      newL.set(this.edgeLevels);
      this.edgeTStates = newT;
      this.edgeLevels = newL;
    }
    this.edgeTStates[this.edgeCount] = tState;
    this.edgeLevels[this.edgeCount] = level;
    this.edgeCount++;
  }

  renderFrame(tStatesInFrame: number, sampleCount: number): Float32Array {
    const out = new Float32Array(sampleCount);
    const tStatesPerSample = tStatesInFrame / sampleCount;
    let edgeIndex = 0;
    let level: number = this.levelAtFrameStart;
    let currentT = 0;

    for (let i = 0; i < sampleCount; i++) {
      const sampleEndT = (i + 1) * tStatesPerSample;
      let accum = 0;

      while (edgeIndex < this.edgeCount && this.edgeTStates[edgeIndex]! < sampleEndT) {
        const edgeT = this.edgeTStates[edgeIndex]!;
        if (edgeT > currentT) {
          accum += level * (edgeT - currentT);
          currentT = edgeT;
        }
        level = this.edgeLevels[edgeIndex]!;
        edgeIndex++;
      }

      if (sampleEndT > currentT) {
        accum += level * (sampleEndT - currentT);
        currentT = sampleEndT;
      }

      const sampleVal = accum / tStatesPerSample;
      out[i] = this.dcBlocker.process(sampleVal);
    }

    this.edgeCount = 0;
    this.levelAtFrameStart = this.currentLevel;
    return out;
  }
}
