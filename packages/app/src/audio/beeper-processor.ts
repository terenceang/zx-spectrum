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

const HEADER_INT32_LENGTH = 3; // matches AUDIO_HEADER_INT32_LENGTH in worker/protocol.ts

class BeeperProcessor extends AudioWorkletProcessor {
  private header: Int32Array | null = null;
  private samples: Float32Array | null = null;
  private capacity = 0;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<{ buffer: SharedArrayBuffer; capacity: number }>) => {
      this.header = new Int32Array(event.data.buffer, 0, HEADER_INT32_LENGTH);
      this.capacity = event.data.capacity;
      this.samples = new Float32Array(event.data.buffer, HEADER_INT32_LENGTH * 4, this.capacity);
    };
  }

  override process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]?.[0];
    if (!out) return true;

    if (!this.header || !this.samples) {
      out.fill(0);
      return true;
    }

    let readIndex = Atomics.load(this.header, 0);
    const writeIndex = Atomics.load(this.header, 1);
    const available = (writeIndex - readIndex + this.capacity) % this.capacity;
    const count = Math.min(available, out.length);
    for (let i = 0; i < count; i++) {
      out[i] = this.samples[readIndex]!;
      readIndex = (readIndex + 1) % this.capacity;
    }
    for (let i = count; i < out.length; i++) out[i] = 0;
    Atomics.store(this.header, 0, readIndex);

    return true;
  }
}

registerProcessor("beeper-processor", BeeperProcessor);
