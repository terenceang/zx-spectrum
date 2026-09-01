import {
  AUDIO_HEADER_INT32_LENGTH,
  audioBufferByteLength,
  frameBufferByteLength,
  type HostToWorkerMessage,
  type MachineModel,
  type WorkerToHostMessage,
} from "../../worker/src/protocol.js";
import { FrameRingReader } from "../../worker/src/ring-buffers.js";

const MAX_WIDTH = 512;
const MAX_HEIGHT = 384;
const AUDIO_CAPACITY_SAMPLES = 44100; // ~1s

export type Frame = { pixels: Uint8Array; width: number; height: number };

/** Main-thread wrapper around the emulation Web Worker. Prefers a SharedArrayBuffer
 * frame/audio transport (tear-free reads via a seqlock, lock-free audio ring); when
 * SharedArrayBuffer is unavailable (cross-origin isolation not set up by the host —
 * see the deployment notes in docs/architecture.md) it transparently falls back to
 * per-frame postMessage + Transferable, at the cost of a small GC/copy overhead. */
export class EmulatorClient {
  private readonly worker: Worker;
  private readonly frameReader: FrameRingReader | null = null;
  readonly usesSharedMemory: boolean;
  readonly audioBuffer: SharedArrayBuffer | null = null;
  readonly audioCapacitySamples = AUDIO_CAPACITY_SAMPLES;

  private latestFallbackFrame: Frame | null = null;
  private latestFallbackAudio: Float32Array | null = null;
  onReady?: () => void;
  onError?: (message: string) => void;
  onTapeStatus?: (playing: boolean) => void;

  constructor() {
    this.worker = new Worker(new URL("../../worker/src/emulator.worker.ts", import.meta.url), {
      type: "module",
    });

    this.usesSharedMemory = typeof SharedArrayBuffer !== "undefined";
    let frameBuffer: SharedArrayBuffer | null = null;
    let audioBuffer: SharedArrayBuffer | null = null;

    if (this.usesSharedMemory) {
      frameBuffer = new SharedArrayBuffer(frameBufferByteLength(MAX_WIDTH, MAX_HEIGHT));
      audioBuffer = new SharedArrayBuffer(audioBufferByteLength(AUDIO_CAPACITY_SAMPLES));
      this.frameReader = new FrameRingReader(frameBuffer, MAX_WIDTH, MAX_HEIGHT);
      this.audioBuffer = audioBuffer;
    }

    this.worker.onmessage = (event: MessageEvent<WorkerToHostMessage>) => {
      const message = event.data;
      if (message.type === "ready") this.onReady?.();
      else if (message.type === "error") this.onError?.(message.message);
      else if (message.type === "tapeStatus") this.onTapeStatus?.(message.playing);
      else if (message.type === "frame") {
        this.latestFallbackFrame = {
          pixels: new Uint8Array(message.pixels),
          width: message.width,
          height: message.height,
        };
        this.latestFallbackAudio = new Float32Array(message.audio);
      }
    };

    this.send({ type: "init", frameBuffer, audioBuffer });
  }

  private send(message: HostToWorkerMessage, transfer?: Transferable[]): void {
    if (transfer) this.worker.postMessage(message, transfer);
    else this.worker.postMessage(message);
  }

  loadRom(model: MachineModel, rom: ArrayBuffer): void {
    this.send({ type: "loadRom", model, rom }, [rom]);
  }

  loadSnapshot(format: "sna" | "z80", data: ArrayBuffer): void {
    this.send({ type: "loadSnapshot", format, data }, [data]);
  }

  loadTape(format: "tap" | "tzx", data: ArrayBuffer): void {
    this.send({ type: "loadTape", format, data }, [data]);
  }

  playTape(): void {
    this.send({ type: "playTape" });
  }

  stopTape(): void {
    this.send({ type: "stopTape" });
  }

  sendKey(row: number, bit: number, down: boolean): void {
    this.send({ type: "keyEvent", row, bit, down });
  }

  pause(): void {
    this.send({ type: "pause" });
  }

  resume(): void {
    this.send({ type: "resume" });
  }

  reset(): void {
    this.send({ type: "reset" });
  }

  /** Call once per rAF tick on the main thread. Returns the latest complete frame,
   * or null if none is available yet. */
  pollFrame(): Frame | null {
    if (this.frameReader) return this.frameReader.read();
    return this.latestFallbackFrame;
  }

  /** Fallback-path only: audio samples for the most recent frame, consumed and
   * cleared by the caller (the SharedArrayBuffer path instead wires the
   * AudioWorklet directly to `audioBuffer`, see audio/audioSink.ts). */
  takeFallbackAudio(): Float32Array | null {
    const audio = this.latestFallbackAudio;
    this.latestFallbackAudio = null;
    return audio;
  }
}

export { AUDIO_HEADER_INT32_LENGTH };
