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
  private lastReadT = 0;
  private consecutiveReads = 0;

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
    this.lastReadT = 0;
    this.consecutiveReads = 0;
  }

  stop(): void {
    this.playing = false;
    this.cpuIndex = 0;
    this.audioIndex = 0;
    this.lastReadT = 0;
    this.consecutiveReads = 0;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  levelAt(tState: number): 0 | 1 {
    if (!this.playing) return 0;

    const dt = tState - this.lastReadT;
    this.lastReadT = tState;
    if (dt < 500) {
      this.consecutiveReads++;
    } else {
      this.consecutiveReads = 1;
    }

    while (this.cpuIndex < this.pulses.length) {
      const pulse = this.pulses[this.cpuIndex]!;
      const elapsed = tState - this.cpuPulseStartT;

      if (elapsed < pulse.duration) {
        break;
      }

      if (pulse.pause) {
        // The nominal pause duration has elapsed.
        // If the CPU is not actively polling port 0xFE in a tape-loading loop
        // (e.g. it is decompressing, running user code, or in a sporadic keyboard
        // interrupt scan), hold the pause by shifting cpuPulseStartT forward so the
        // next block's pilot tone is not consumed while the CPU isn't listening.
        if (this.consecutiveReads < 2) {
          this.cpuPulseStartT = tState - pulse.duration + 1;
          break;
        }
      }

      this.cpuPulseStartT += pulse.duration;
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
        if (this.audioIndex >= this.cpuIndex && this.pulses[this.audioIndex]?.pause) {
          this.audioPulseStartT = this.cpuPulseStartT;
          break;
        }
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
