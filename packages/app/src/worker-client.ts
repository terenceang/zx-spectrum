import {
  AUDIO_CAPACITY_FLOATS,
  AUDIO_HEADER_INT32_LENGTH,
  MAX_FRAME_HEIGHT,
  MAX_FRAME_WIDTH,
  audioBufferByteLength,
  frameBufferByteLength,
  type HostToWorkerMessage,
  type MachineModel,
  type WorkerToHostMessage,
} from "../../worker/src/protocol.js";
import { FrameRingReader } from "../../worker/src/ring-buffers.js";

export type Frame = { pixels: Uint8Array; width: number; height: number };

/** Main-thread wrapper around the emulation Web Worker. Prefers a SharedArrayBuffer
 * frame/audio transport (tear-free reads via a seqlock, lock-free audio ring); when
 * SharedArrayBuffer is unavailable (cross-origin isolation not set up by the host)
 * it transparently falls back to per-frame postMessage + Transferable. */
export class EmulatorClient {
  private readonly worker: Worker;
  private readonly frameReader: FrameRingReader | null = null;
  readonly usesSharedMemory: boolean;
  readonly audioBuffer: SharedArrayBuffer | null = null;
  readonly audioCapacitySamples = AUDIO_CAPACITY_FLOATS;

  private latestFallbackFrame: Frame | null = null;
  private latestFallbackAudio: Float32Array | null = null;
  private readonly pendingSnapshotRequests: ((data: ArrayBuffer) => void)[] = [];
  private readonly pendingStateRequests: ((data: { slot: number; data: ArrayBuffer; model: MachineModel }) => void)[] = [];

  onReady?: () => void;
  onError?: (message: string) => void;
  onTapeStatus?: (playing: boolean) => void;
  onDiskStatus?: (status: { inserted: boolean; motorOn: boolean; track: number }) => void;

  constructor() {
    this.worker = new Worker(new URL("../../worker/src/emulator.worker.ts", import.meta.url), {
      type: "module",
    });

    this.worker.onerror = (e) => {
      this.onError?.(e.message || "Worker error");
    };

    this.usesSharedMemory = typeof SharedArrayBuffer !== "undefined";
    let frameBuffer: SharedArrayBuffer | null = null;
    let audioBuffer: SharedArrayBuffer | null = null;

    if (this.usesSharedMemory) {
      frameBuffer = new SharedArrayBuffer(frameBufferByteLength(MAX_FRAME_WIDTH, MAX_FRAME_HEIGHT));
      audioBuffer = new SharedArrayBuffer(audioBufferByteLength(AUDIO_CAPACITY_FLOATS));
      this.frameReader = new FrameRingReader(frameBuffer, MAX_FRAME_WIDTH, MAX_FRAME_HEIGHT);
      this.audioBuffer = audioBuffer;
    }

    this.worker.onmessage = (event: MessageEvent<WorkerToHostMessage>) => {
      const message = event.data;
      if (message.type === "ready") this.onReady?.();
      else if (message.type === "error") this.onError?.(message.message);
      else if (message.type === "tapeStatus") this.onTapeStatus?.(message.playing);
      else if (message.type === "diskStatus") {
        this.onDiskStatus?.({ inserted: message.inserted, motorOn: message.motorOn, track: message.track });
      } else if (message.type === "frame") {
        this.latestFallbackFrame = {
          pixels: new Uint8Array(message.pixels),
          width: message.width,
          height: message.height,
        };
        this.latestFallbackAudio = new Float32Array(message.audio);
      } else if (message.type === "snapshotData") {
        this.pendingSnapshotRequests.shift()?.(message.data);
      } else if (message.type === "stateData") {
        this.pendingStateRequests.shift()?.({ slot: message.slot, data: message.data, model: message.model });
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

  loadDisk(data: ArrayBuffer): void {
    this.send({ type: "loadDisk", data }, [data]);
  }

  ejectDisk(): void {
    this.send({ type: "ejectDisk" });
  }

  setTapeSound(enabled: boolean): void {
    this.send({ type: "setTapeSound", enabled });
  }

  setFastTapeLoad(enabled: boolean): void {
    this.send({ type: "setFastTapeLoad", enabled });
  }

  setAudioMode(mode: "mono" | "acb" | "abc"): void {
    this.send({ type: "setAudioMode", mode });
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

  reset(pageRom1 = false): void {
    this.send({ type: "reset", pageRom1 });
  }

  saveSnapshot(format: "sna" | "z80" = "sna"): Promise<ArrayBuffer> {
    return new Promise((resolve) => {
      this.pendingSnapshotRequests.push(resolve);
      this.send({ type: "saveSnapshot", format });
    });
  }

  saveState(slot: number): Promise<{ slot: number; data: ArrayBuffer; model: MachineModel }> {
    return new Promise((resolve) => {
      this.pendingStateRequests.push(resolve);
      this.send({ type: "saveState", slot });
    });
  }

  loadState(
    slot: number,
    data: ArrayBuffer,
    model: MachineModel,
    format?: "sna" | "z80",
  ): void {
    this.send({ type: "loadState", slot, data, model, format }, [data]);
  }

  exportState(
    data: ArrayBuffer,
    model: MachineModel,
    targetFormat: "sna" | "z80",
    inputFormat?: "sna" | "z80",
  ): Promise<ArrayBuffer> {
    return new Promise((resolve) => {
      this.pendingSnapshotRequests.push(resolve);
      this.send({ type: "exportState", data, model, targetFormat, inputFormat }, [data]);
    });
  }

  pollFrame(): Frame | null {
    if (this.frameReader) return this.frameReader.read();
    const f = this.latestFallbackFrame;
    this.latestFallbackFrame = null;
    return f;
  }

  takeFallbackAudio(): Float32Array | null {
    const a = this.latestFallbackAudio;
    this.latestFallbackAudio = null;
    return a;
  }
}

export { AUDIO_HEADER_INT32_LENGTH };
