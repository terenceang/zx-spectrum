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
  private nextFallbackStartTime = 0;

  async start(client: EmulatorClient): Promise<void> {
    this.audioContext = new AudioContext({ sampleRate: 44100 });
    if (this.audioContext.state === "suspended") await this.audioContext.resume();

    if (client.usesSharedMemory && client.audioBuffer) {
      await this.audioContext.audioWorklet.addModule(beeperProcessorUrl);
      this.workletNode = new AudioWorkletNode(this.audioContext, "beeper-processor");
      this.workletNode.port.postMessage({
        buffer: client.audioBuffer,
        capacity: client.audioCapacitySamples,
      });
      this.workletNode.connect(this.audioContext.destination);
    }
  }

  /** Call once per rAF tick when running in fallback mode (usesSharedMemory ===
   * false); no-op otherwise. */
  pumpFallbackAudio(client: EmulatorClient): void {
    if (!this.audioContext || client.usesSharedMemory) return;
    const samples = client.takeFallbackAudio();
    if (!samples || samples.length === 0) return;

    const buffer = this.audioContext.createBuffer(1, samples.length, this.audioContext.sampleRate);
    buffer.getChannelData(0).set(samples);
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);

    const now = this.audioContext.currentTime;
    const startTime = Math.max(now, this.nextFallbackStartTime);
    source.start(startTime);
    this.nextFallbackStartTime = startTime + buffer.duration;
  }

  suspend(): void {
    void this.audioContext?.suspend();
  }

  resume(): void {
    void this.audioContext?.resume();
  }
}
