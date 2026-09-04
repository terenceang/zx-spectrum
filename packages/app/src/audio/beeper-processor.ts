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

class AudioRingReader {
  private readonly header: Int32Array;
  private readonly samples: Float32Array;
  private readonly capacity: number;
  private readonly minBufferSamples: number;
  private prebuffered = false;

  constructor(buffer: SharedArrayBuffer, capacitySamples: number, minBufferSamples = 1764) {
    this.header = new Int32Array(buffer, 0, 3);
    this.samples = new Float32Array(buffer, 12, capacitySamples);
    this.capacity = capacitySamples;
    this.minBufferSamples = minBufferSamples;
  }

  read(out: Float32Array): void {
    let readIndex = Atomics.load(this.header, 0);
    const writeIndex = Atomics.load(this.header, 1);
    const available = (writeIndex - readIndex + this.capacity) % this.capacity;

    if (!this.prebuffered) {
      if (available >= this.minBufferSamples) {
        this.prebuffered = true;
      } else {
        out.fill(0);
        return;
      }
    }

    if (available === 0) {
      this.prebuffered = false;
      out.fill(0);
      return;
    }

    const count = Math.min(available, out.length);
    for (let i = 0; i < count; i++) {
      out[i] = this.samples[readIndex]!;
      readIndex = (readIndex + 1) % this.capacity;
    }
    for (let i = count; i < out.length; i++) out[i] = 0;
    Atomics.store(this.header, 0, readIndex);
  }

  readStereo(outLeft: Float32Array, outRight?: Float32Array): void {
    let readIndex = Atomics.load(this.header, 0);
    const writeIndex = Atomics.load(this.header, 1);
    const available = (writeIndex - readIndex + this.capacity) % this.capacity;

    if (!this.prebuffered) {
      if (available >= this.minBufferSamples) {
        this.prebuffered = true;
      } else {
        outLeft.fill(0);
        if (outRight) outRight.fill(0);
        return;
      }
    }

    if (available < 2) {
      this.prebuffered = false;
      outLeft.fill(0);
      if (outRight) outRight.fill(0);
      return;
    }

    const pairs = Math.min(Math.floor(available / 2), outLeft.length);
    for (let i = 0; i < pairs; i++) {
      outLeft[i] = this.samples[readIndex]!;
      readIndex = (readIndex + 1) % this.capacity;
      const r = this.samples[readIndex]!;
      readIndex = (readIndex + 1) % this.capacity;
      if (outRight) outRight[i] = r;
    }
    for (let i = pairs; i < outLeft.length; i++) {
      outLeft[i] = 0;
      if (outRight) outRight[i] = 0;
    }
    Atomics.store(this.header, 0, readIndex);
  }
}

class BeeperProcessor extends AudioWorkletProcessor {
  private ring: AudioRingReader | null = null;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<{ buffer: SharedArrayBuffer; capacity: number }>) => {
      this.ring = new AudioRingReader(event.data.buffer, event.data.capacity);
    };
  }

  override process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const outLeft = outputs[0]?.[0];
    const outRight = outputs[0]?.[1];
    if (!outLeft) return true;

    if (!this.ring) {
      outLeft.fill(0);
      if (outRight) outRight.fill(0);
      return true;
    }

    this.ring.readStereo(outLeft, outRight);
    return true;
  }
}

registerProcessor("beeper-processor", BeeperProcessor);
