import { AUDIO_HEADER_INT32_LENGTH, FRAME_HEADER_INT32_LENGTH } from "./protocol.js";

/** Worker-side writer for the shared frame buffer: a classic seqlock (bump the
 * counter to odd, write, bump to even) so the reader can detect and retry a torn
 * read instead of needing two full buffer copies. */
export class FrameRingWriter {
  private readonly header: Int32Array;
  private readonly pixels: Uint8Array;

  constructor(buffer: SharedArrayBuffer, maxWidth: number, maxHeight: number) {
    this.header = new Int32Array(buffer, 0, FRAME_HEADER_INT32_LENGTH);
    this.pixels = new Uint8Array(buffer, FRAME_HEADER_INT32_LENGTH * 4, maxWidth * maxHeight);
  }

  write(pixels: Uint8Array, width: number, height: number): void {
    Atomics.add(this.header, 0, 1); // -> odd: writing
    this.pixels.set(pixels.subarray(0, Math.min(pixels.length, this.pixels.length)));
    Atomics.store(this.header, 1, width);
    Atomics.store(this.header, 2, height);
    Atomics.add(this.header, 0, 1); // -> even: stable
  }
}

/** Main-thread reader for the shared frame buffer. Returns null only before the
 * first frame has ever been written. */
export class FrameRingReader {
  private readonly header: Int32Array;
  private readonly pixels: Uint8Array;

  constructor(buffer: SharedArrayBuffer, maxWidth: number, maxHeight: number) {
    this.header = new Int32Array(buffer, 0, FRAME_HEADER_INT32_LENGTH);
    this.pixels = new Uint8Array(buffer, FRAME_HEADER_INT32_LENGTH * 4, maxWidth * maxHeight);
  }

  read(): { pixels: Uint8Array; width: number; height: number } | null {
    for (let attempt = 0; attempt < 8; attempt++) {
      const seqBefore = Atomics.load(this.header, 0);
      if (seqBefore === 0) return null; // never written
      if (seqBefore % 2 !== 0) continue; // mid-write, retry
      const width = Atomics.load(this.header, 1);
      const height = Atomics.load(this.header, 2);
      const out = this.pixels.slice(0, width * height);
      const seqAfter = Atomics.load(this.header, 0);
      if (seqAfter === seqBefore) return { pixels: out, width, height };
    }
    return null; // gave up after a handful of torn reads — next rAF tick tries again
  }
}

/** Lock-free single-producer/single-consumer ring buffer for PCM audio samples
 * (Float32, in [-1, 1]), shared between the emulation worker (producer) and an
 * AudioWorkletProcessor on the main thread's realtime audio thread (consumer). */
export class AudioRing {
  private readonly header: Int32Array;
  private readonly samples: Float32Array;
  private readonly capacity: number;
  private readonly minBufferSamples: number;
  private prebuffered = false;

  constructor(buffer: SharedArrayBuffer, capacitySamples: number, minBufferSamples = 1764) {
    this.header = new Int32Array(buffer, 0, AUDIO_HEADER_INT32_LENGTH);
    this.samples = new Float32Array(buffer, AUDIO_HEADER_INT32_LENGTH * 4, capacitySamples);
    this.capacity = capacitySamples;
    this.minBufferSamples = minBufferSamples;
    if (Atomics.load(this.header, 2) === 0) Atomics.store(this.header, 2, capacitySamples);
  }

  /** Producer side (worker): writes as many samples as fit without overwriting
   * unread data; silently drops the rest (the audio thread is presumed to be
   * keeping up — if it isn't, dropping newest samples is less audible than
   * corrupting the ring). */
  write(data: Float32Array): number {
    const readIndex = Atomics.load(this.header, 0);
    let writeIndex = Atomics.load(this.header, 1);
    const used = (writeIndex - readIndex + this.capacity) % this.capacity;
    const free = this.capacity - used - 1;
    const count = Math.min(free, data.length);
    for (let i = 0; i < count; i++) {
      this.samples[writeIndex] = data[i]!;
      writeIndex = (writeIndex + 1) % this.capacity;
    }
    Atomics.store(this.header, 1, writeIndex);
    return count;
  }

  /** Consumer side (AudioWorkletProcessor): fills `out` with available samples,
   * padding with silence (0) if the ring underruns. Requires an initial prebuffer
   * watermark (~40ms) to absorb frame-interval jitter. */
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
}
