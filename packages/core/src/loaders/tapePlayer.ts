import type { TapePulseSequence } from "./tapePulse.js";

/** T-state-driven tape playback: the ULA polls `levelAt()` on every port 0xFE read
 * (bit 6, EAR) exactly like real tape hardware, driven by the machine's own
 * absolute (never-reset-per-frame) T-state counter. Advances lazily and only
 * forward, so calling it is O(1) amortized regardless of how many T-states have
 * elapsed since the last call. */
export class TapeEdgePlayer {
  private pulses: TapePulseSequence = [];
  private index = 0;
  private pulseStartT = 0;
  private playing = false;

  load(pulses: TapePulseSequence): void {
    this.pulses = pulses;
    this.index = 0;
    this.playing = false;
  }

  start(atTState: number): void {
    if (this.pulses.length === 0) return;
    this.playing = true;
    this.index = 0;
    this.pulseStartT = atTState;
  }

  stop(): void {
    this.playing = false;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  levelAt(tState: number): 0 | 1 {
    if (!this.playing) return 0;
    while (
      this.index < this.pulses.length &&
      tState - this.pulseStartT >= this.pulses[this.index]!.duration
    ) {
      this.pulseStartT += this.pulses[this.index]!.duration;
      this.index++;
    }
    if (this.index >= this.pulses.length) {
      this.playing = false;
      return 0;
    }
    return this.pulses[this.index]!.level;
  }
}
