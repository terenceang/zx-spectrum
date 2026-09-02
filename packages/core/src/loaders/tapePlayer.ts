import { DcBlocker } from "../audio/dcBlocker.js";
import type { TapeBlock, TapePulseSequence } from "./tapePulse.js";

/** T-state-driven tape playback: the ULA polls `levelAt()` on every port 0xFE read
 * (bit 6, EAR) exactly like real tape hardware, driven by the machine's own
 * absolute (never-reset-per-frame) T-state counter. Advances lazily and only
 * forward, so calling it is O(1) amortized regardless of how many T-states have
 * elapsed since the last call. */
export class TapeEdgePlayer {
  private pulses: TapePulseSequence = [];
  private blocks: TapeBlock[] = [];
  private currentBlockIndex = 0;
  private cpuIndex = 0;
  private cpuPulseStartT = 0;
  private audioIndex = 0;
  private audioPulseStartT = 0;
  private readonly dcBlocker = new DcBlocker();
  private playing = false;
  private lastReadT = 0;
  private consecutiveReads = 0;

  load(pulses: TapePulseSequence): void {
    this.pulses = pulses;
    this.blocks = pulses.blocks ?? [];
    this.currentBlockIndex = 0;
    this.stop();
  }

  start(atTState: number): void {
    if (this.pulses.length === 0) return;
    this.playing = true;
    this.cpuIndex = 0;
    this.cpuPulseStartT = atTState;
    this.audioIndex = 0;
    this.audioPulseStartT = atTState;
    this.dcBlocker.reset();
    this.lastReadT = 0;
    this.consecutiveReads = 0;
    this.currentBlockIndex = 0;
  }

  stop(): void {
    this.playing = false;
    this.cpuIndex = 0;
    this.audioIndex = 0;
    this.dcBlocker.reset();
    this.lastReadT = 0;
    this.consecutiveReads = 0;
    this.currentBlockIndex = 0;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  getNextBlock(): TapeBlock | null {
    return this.blocks[this.currentBlockIndex] ?? null;
  }

  hasBlocks(): boolean {
    return this.currentBlockIndex < this.blocks.length;
  }

  advanceBlock(currentTState: number): void {
    if (this.currentBlockIndex >= this.blocks.length) return;
    const block = this.blocks[this.currentBlockIndex]!;
    this.currentBlockIndex++;

    this.cpuIndex = Math.max(this.cpuIndex, block.pulseEndIndex);
    this.audioIndex = Math.max(this.audioIndex, block.pulseEndIndex);
    this.cpuPulseStartT = currentTState;
    this.audioPulseStartT = currentTState;

    if (this.currentBlockIndex >= this.blocks.length || this.cpuIndex >= this.pulses.length) {
      this.playing = false;
    }
  }

  rewind(): void {
    this.currentBlockIndex = 0;
    this.cpuIndex = 0;
    this.audioIndex = 0;
    this.dcBlocker.reset();
    this.lastReadT = 0;
    this.consecutiveReads = 0;
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

    while (
      this.currentBlockIndex < this.blocks.length &&
      this.cpuIndex >= this.blocks[this.currentBlockIndex]!.pulseEndIndex
    ) {
      this.currentBlockIndex++;
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
      out[i] = this.dcBlocker.process(this.pulses[this.audioIndex]!.level ? 1 : 0);
    }

    return out;
  }
}
