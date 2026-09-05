import { AUDIO_HEADER_INT32_LENGTH, FRAME_HEADER_INT32_LENGTH } from "./protocol.js";

export class FrameRingWriter {
  private readonly header: Int32Array;
  private readonly pixels: Uint8Array;

  constructor(buffer: SharedArrayBuffer, maxWidth: number, maxHeight: number) {
    this.header = new Int32Array(buffer, 0, FRAME_HEADER_INT32_LENGTH);
    this.pixels = new Uint8Array(buffer, FRAME_HEADER_INT32_LENGTH * 4, maxWidth * maxHeight);
  }

  write(pixels: Uint8Array, width: number, height: number): void {
    Atomics.add(this.header, 0, 1);
    this.pixels.set(pixels.subarray(0, Math.min(pixels.length, this.pixels.length)));
    Atomics.store(this.header, 1, width);
    Atomics.store(this.header, 2, height);
    Atomics.add(this.header, 0, 1);
  }
}

export class FrameRingReader {
  private readonly header: Int32Array;
  private readonly pixels: Uint8Array;
  private lastSeq = 0;

  constructor(buffer: SharedArrayBuffer, maxWidth: number, maxHeight: number) {
    this.header = new Int32Array(buffer, 0, FRAME_HEADER_INT32_LENGTH);
    this.pixels = new Uint8Array(buffer, FRAME_HEADER_INT32_LENGTH * 4, maxWidth * maxHeight);
  }

  getSequence(): number {
    return Atomics.load(this.header, 0);
  }

  read(force = false): { pixels: Uint8Array; width: number; height: number } | null {
    for (let attempt = 0; attempt < 8; attempt++) {
      const seqBefore = Atomics.load(this.header, 0);
      if (seqBefore === 0) return null;
      if (!force && seqBefore === this.lastSeq) return null;
      if (seqBefore % 2 !== 0) continue;
      const w = Atomics.load(this.header, 1);
      const h = Atomics.load(this.header, 2);
      const pixelCount = w * h;
      if (pixelCount > this.pixels.length) continue;
      const out = this.pixels.slice(0, pixelCount);
      const seqAfter = Atomics.load(this.header, 0);
      if (seqAfter === seqBefore) {
        this.lastSeq = seqAfter;
        return { pixels: out, width: w, height: h };
      }
    }
    return null;
  }
}

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
