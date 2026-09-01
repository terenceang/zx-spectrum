import type { TapePulseSequence } from "./tapePulse.js";

/** T-state-driven tape playback: the ULA polls `levelAt()` on every port 0xFE read
 * (bit 6, EAR) exactly like real tape hardware, driven by the machine's own
 * absolute (never-reset-per-frame) T-state counter. Advances lazily and only
 * forward, so calling it is O(1) amortized regardless of how many T-states have
 * elapsed since the last call. */
export class TapeEdgePlayer {
  private pulses: TapePulseSequence = [];
  private cpuIndex = 0;
  private cpuPulseStartT = 0;
  private audioIndex = 0;
  private audioPulseStartT = 0;
  private dcPrevIn = 0;
  private dcPrevOut = 0;
  private playing = false;

  load(pulses: TapePulseSequence): void {
    this.pulses = pulses;
    this.stop();
  }

  start(atTState: number): void {
    if (this.pulses.length === 0) return;
    this.playing = true;
    this.cpuIndex = 0;
    this.cpuPulseStartT = atTState;
    this.audioIndex = 0;
    this.audioPulseStartT = atTState;
    this.dcPrevIn = 0;
    this.dcPrevOut = 0;
  }

  stop(): void {
    this.playing = false;
    this.cpuIndex = 0;
    this.audioIndex = 0;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  levelAt(tState: number): 0 | 1 {
    if (!this.playing) return 0;
    while (
      this.cpuIndex < this.pulses.length &&
      tState - this.cpuPulseStartT >= this.pulses[this.cpuIndex]!.duration
    ) {
      this.cpuPulseStartT += this.pulses[this.cpuIndex]!.duration;
      this.cpuIndex++;
    }
    if (this.cpuIndex >= this.pulses.length) {
      this.playing = false;
      return 0;
    }
    return this.pulses[this.cpuIndex]!.level;
  }

  /** Renders tape pulses across [startT, startT + durationT) into PCM audio samples
   * with a DC blocker, allowing tape loading screech/pilot tones to be heard. */
  renderFrameAudio(startT: number, durationT: number, sampleCount: number): Float32Array {
    const out = new Float32Array(sampleCount);
    if (!this.playing && this.audioIndex >= this.pulses.length) {
      return out;
    }

    const tStatesPerSample = durationT / sampleCount;
    const R = 0.995;

    for (let i = 0; i < sampleCount; i++) {
      const sampleEndT = startT + (i + 1) * tStatesPerSample;
      while (
        this.audioIndex < this.pulses.length &&
        sampleEndT - this.audioPulseStartT >= this.pulses[this.audioIndex]!.duration
      ) {
        this.audioPulseStartT += this.pulses[this.audioIndex]!.duration;
        this.audioIndex++;
      }
      if (this.audioIndex >= this.pulses.length) {
        this.playing = false;
        break;
      }
      const raw = this.pulses[this.audioIndex]!.level ? 1 : 0;
      const y = raw - this.dcPrevIn + R * this.dcPrevOut;
      this.dcPrevIn = raw;
      this.dcPrevOut = y;
      out[i] = Math.max(-1, Math.min(1, y));
    }

    return out;
  }
}
