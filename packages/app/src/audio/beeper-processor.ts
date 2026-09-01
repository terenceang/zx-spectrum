import { AudioRing } from "../../../worker/src/ring-buffers.js";

// Runs inside the AudioWorkletGlobalScope, a separate realtime thread from both the
// main thread and the emulation worker — reads directly from the shared audio ring
// buffer so audio never depends on main-thread rAF timing or worker frame jitter.
// TypeScript's default DOM lib doesn't ship AudioWorkletGlobalScope's ambient types
// (it's a distinct global scope from window), hence the minimal declarations below.

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: unknown): boolean;
}
declare function registerProcessor(
  name: string,
  processorCtor: new (options?: unknown) => AudioWorkletProcessor,
): void;

class BeeperProcessor extends AudioWorkletProcessor {
  private ring: AudioRing | null = null;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<{ buffer: SharedArrayBuffer; capacity: number }>) => {
      this.ring = new AudioRing(event.data.buffer, event.data.capacity);
    };
  }

  override process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]?.[0];
    if (!out) return true;

    if (!this.ring) {
      out.fill(0);
      return true;
    }

    this.ring.read(out);
    return true;
  }
}

registerProcessor("beeper-processor", BeeperProcessor);
