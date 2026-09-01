// Plain `?url` just copies the file as a raw asset without running it through
// esbuild first — harmless for a `.js` source, but wrong for `.ts`: for a `.ts`
// file it (a) guesses the MIME type from the extension as `video/mp2t` (MPEG-TS!)
// and (b) ships un-transpiled TypeScript syntax the browser can't parse.
// `?worker&url` instead routes the file through Vite's worker bundling pipeline —
// which does transpile/bundle it as a standalone ES module — and hands back the
// URL of the *built* output. AudioWorkletProcessor modules are structurally the
// same shape as a worker module (self-contained, no HMR runtime needed), so this
// pipeline works for them too even though they aren't literally a Worker.
import beeperProcessorUrl from "./beeper-processor.ts?worker&url";
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
      await this.audioContext.audioWorklet.addModule(beeperProcessorUrl);
      this.workletNode = new AudioWorkletNode(this.audioContext, "beeper-processor");
      this.workletNode.port.postMessage({
        buffer: client.audioBuffer,
        capacity: client.audioCapacitySamples,
      });
      this.workletNode.connect(this.gainNode!);
    }
  }

  /** Call once per rAF tick when running in fallback mode (usesSharedMemory ===
   * false); no-op otherwise. */
  pumpFallbackAudio(client: EmulatorClient): void {
    if (!this.audioContext || !this.gainNode || client.usesSharedMemory) return;
    const samples = client.takeFallbackAudio();
    if (!samples || samples.length === 0) return;

    const buffer = this.audioContext.createBuffer(1, samples.length, this.audioContext.sampleRate);
    buffer.getChannelData(0).set(samples);
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gainNode);

    const now = this.audioContext.currentTime;
    const startTime = Math.max(now, this.nextFallbackStartTime);
    source.start(startTime);
    this.nextFallbackStartTime = startTime + buffer.duration;
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
      this.gainNode.gain.setValueAtTime(this.muted ? 0 : this.volume, this.audioContext?.currentTime ?? 0);
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
}
