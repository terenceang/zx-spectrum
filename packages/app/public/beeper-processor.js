/* global AudioWorkletProcessor, registerProcessor */

class AudioRingReader {
  constructor(buffer, capacitySamples, minBufferSamples = 1764) {
    this.header = new Int32Array(buffer, 0, 3);
    this.samples = new Float32Array(buffer, 12, capacitySamples);
    this.capacity = capacitySamples;
    this.minBufferSamples = minBufferSamples;
    this.prebuffered = false;
  }

  read(out) {
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
      out[i] = this.samples[readIndex];
      readIndex = (readIndex + 1) % this.capacity;
    }
    for (let i = count; i < out.length; i++) out[i] = 0;
    Atomics.store(this.header, 0, readIndex);
  }
}

class BeeperProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = null;
    this.port.onmessage = (event) => {
      this.ring = new AudioRingReader(event.data.buffer, event.data.capacity);
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
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
