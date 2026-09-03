import type { MachineModel, SnapshotFormat, TapeFormat } from "@zx-spectrum/core";

export type { MachineModel };

export type HostToWorkerMessage =
  | { type: "init"; frameBuffer: SharedArrayBuffer | null; audioBuffer: SharedArrayBuffer | null }
  /** `rom` is a single 16384-byte image for "48k", or two 16384-byte ROMs
   * concatenated (rom0 then rom1) into a 32768-byte buffer for "128k". */
  | { type: "loadRom"; model: MachineModel; rom: ArrayBuffer }
  | { type: "loadSnapshot"; format: SnapshotFormat; data: ArrayBuffer }
  | { type: "loadTape"; format: TapeFormat; data: ArrayBuffer; autoStart?: boolean }
  | { type: "playTape" }
  | { type: "stopTape" }
  | { type: "setTapeSound"; enabled: boolean }
  | { type: "setFastTapeLoad"; enabled: boolean }
  | { type: "keyEvent"; row: number; bit: number; down: boolean }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "reset" };

export type WorkerToHostMessage =
  | { type: "ready" }
  | { type: "frame"; pixels: ArrayBuffer; width: number; height: number; audio: ArrayBuffer }
  | { type: "tapeStatus"; playing: boolean }
  | { type: "error"; message: string };

export const MAX_FRAME_WIDTH = 512;
export const MAX_FRAME_HEIGHT = 384;
export const DEFAULT_SAMPLE_RATE = 44100;
export const AUDIO_CAPACITY_SAMPLES = 44100; // ~1s
export const SPECTRUM_FPS = 50;
export const FRAME_INTERVAL_MS = 1000 / SPECTRUM_FPS;
export const SAMPLES_PER_FRAME = Math.round(DEFAULT_SAMPLE_RATE / SPECTRUM_FPS);

/** Layout of the shared frame buffer: a small header (as Int32 words) — a seqlock
 * counter plus width/height — followed by one palette-indexed pixel buffer. A
 * seqlock (odd counter = mid-write; reader retries if the counter changed across
 * its read) avoids needing two full buffer copies for tear-free reads. */
export const FRAME_HEADER_INT32_LENGTH = 3; // [seq, width, height]

export function frameBufferByteLength(
  maxWidth = MAX_FRAME_WIDTH,
  maxHeight = MAX_FRAME_HEIGHT,
): number {
  return FRAME_HEADER_INT32_LENGTH * 4 + maxWidth * maxHeight;
}

/** Layout of the shared audio ring buffer: a small header (as Int32 words: read
 * index, write index, capacity in samples) followed by the sample ring itself. */
export const AUDIO_HEADER_INT32_LENGTH = 3; // [readIndex, writeIndex, capacity]

export function audioBufferByteLength(capacitySamples = AUDIO_CAPACITY_SAMPLES): number {
  return AUDIO_HEADER_INT32_LENGTH * 4 + capacitySamples * 4;
}
