const beeperProcessorUrl = `${import.meta.env.BASE_URL}beeper-processor.js`;
import type { EmulatorClient } from "../worker-client.js";

/** Wires up beeper playback for an EmulatorClient. SharedArrayBuffer path: an
 * AudioWorkletNode reads the shared ring directly on the realtime audio thread —
 * this is the path that matters, since it's immune to both UI jank and worker
 * frame-timing jitter. Fallback path: queues each frame's audio chunk as its own
 * AudioBufferSourceNode, scheduled back-to-back — simpler than a worklet but more
 * prone to audible glitches under jank, which is an acceptable trade for the rare
 * case where cross-origin isolation isn't available. */
export class AudioSink {
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private gainNode: GainNode | null = null;
  private nextFallbackStartTime = 0;
  private readonly fallbackBufferPool: { buffer: AudioBuffer; releaseTime: number }[] = [];
  private volume: number;
  private muted: boolean;

  constructor(initialVolume = 0.5, initialMuted = false) {
    this.volume = Math.max(0, Math.min(1, initialVolume));
    this.muted = initialMuted;
  }

  async start(client: EmulatorClient): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: 44100 });
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = this.muted ? 0 : this.volume;
      this.gainNode.connect(this.audioContext.destination);
    }
    if (this.audioContext.state === "suspended") {
      try {
        await this.audioContext.resume();
      } catch {
        // Autoplay policy may block resume before user interaction
      }
    }

    if (client.usesSharedMemory && client.audioBuffer && !this.workletNode) {
      try {
        await this.audioContext.audioWorklet.addModule(beeperProcessorUrl);
        this.workletNode = new AudioWorkletNode(this.audioContext, "beeper-processor");
        this.workletNode.port.postMessage({
          buffer: client.audioBuffer,
          capacity: client.audioCapacitySamples,
        });
        this.workletNode.connect(this.gainNode!);
      } catch (err) {
        console.error("Failed to load AudioWorklet module:", err);
      }
    }
  }

  /** Call once per rAF tick when running in fallback mode (usesSharedMemory ===
   * false); no-op otherwise. AudioBufferSourceNodes are single-use by spec, but the
   * underlying AudioBuffers are pooled and reused once their scheduled playback has
   * finished, to keep per-frame GC churn low on this rarely-exercised path. */
  pumpFallbackAudio(client: EmulatorClient): void {
    if (!this.audioContext || !this.gainNode || client.usesSharedMemory) return;
    const samples = client.takeFallbackAudio();
    if (!samples || samples.length === 0) return;

    const pairs = Math.floor(samples.length / 2);
    const now = this.audioContext.currentTime;
    const buffer = this.acquireFallbackBuffer(pairs, now);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    for (let i = 0; i < pairs; i++) {
      left[i] = samples[i * 2]!;
      right[i] = samples[i * 2 + 1]!;
    }
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gainNode);

    const startTime = Math.max(now, this.nextFallbackStartTime);
    source.start(startTime);
    this.nextFallbackStartTime = startTime + buffer.duration;
    this.releaseFallbackBuffer(buffer, startTime + buffer.duration);
  }

  /** Finds a pooled buffer whose last scheduled playback has fully finished, or
   * allocates a fresh one. A buffer must never be rewritten while a scheduled or
   * playing source still references it, hence the releaseTime watermark. */
  private acquireFallbackBuffer(length: number, now: number): AudioBuffer {
    for (let i = 0; i < this.fallbackBufferPool.length; i++) {
      const entry = this.fallbackBufferPool[i]!;
      if (entry.releaseTime <= now) {
        if (entry.buffer.length === length) return entry.buffer;
        this.fallbackBufferPool.splice(i, 1);
        break;
      }
    }
    return this.audioContext!.createBuffer(2, length, this.audioContext!.sampleRate);
  }

  private releaseFallbackBuffer(buffer: AudioBuffer, releaseTime: number): void {
    const existing = this.fallbackBufferPool.find((e) => e.buffer === buffer);
    if (existing) {
      existing.releaseTime = releaseTime;
    } else {
      this.fallbackBufferPool.push({ buffer, releaseTime });
    }
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.gainNode && !this.muted) {
      this.gainNode.gain.setValueAtTime(this.volume, this.audioContext?.currentTime ?? 0);
    }
  }

  getVolume(): number {
    return this.volume;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.gainNode) {
      this.gainNode.gain.setValueAtTime(
        this.muted ? 0 : this.volume,
        this.audioContext?.currentTime ?? 0,
      );
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  suspend(): void {
    void this.audioContext?.suspend();
  }

  async resume(): Promise<void> {
    if (this.audioContext && this.audioContext.state === "suspended") {
      try {
        await this.audioContext.resume();
      } catch {
        // Autoplay policy may block until user interaction
      }
    }
  }

  getState(): AudioContextState | "uninitialized" {
    return this.audioContext?.state ?? "uninitialized";
  }
}
