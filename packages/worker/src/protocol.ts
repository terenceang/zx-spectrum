export type MachineModel = "48k";

export type HostToWorkerMessage =
  | { type: "init"; frameBuffer: SharedArrayBuffer | null; audioBuffer: SharedArrayBuffer | null }
  | { type: "loadRom"; model: MachineModel; rom: ArrayBuffer }
  | { type: "loadSnapshot"; format: "sna" | "z80"; data: ArrayBuffer }
  | { type: "keyEvent"; row: number; bit: number; down: boolean }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "reset" };

export type WorkerToHostMessage =
  | { type: "ready" }
  | { type: "frame"; pixels: ArrayBuffer; width: number; height: number; audio: ArrayBuffer }
  | { type: "error"; message: string };

/** Layout of the shared frame buffer: a small header (as Int32 words) — a seqlock
 * counter plus width/height — followed by one palette-indexed pixel buffer. A
 * seqlock (odd counter = mid-write; reader retries if the counter changed across
 * its read) avoids needing two full buffer copies for tear-free reads. */
export const FRAME_HEADER_INT32_LENGTH = 3; // [seq, width, height]

export function frameBufferByteLength(maxWidth: number, maxHeight: number): number {
  return FRAME_HEADER_INT32_LENGTH * 4 + maxWidth * maxHeight;
}

/** Layout of the shared audio ring buffer: a small header (as Int32 words: read
 * index, write index, capacity in samples) followed by the sample ring itself. */
export const AUDIO_HEADER_INT32_LENGTH = 3; // [readIndex, writeIndex, capacity]

export function audioBufferByteLength(capacitySamples: number): number {
  return AUDIO_HEADER_INT32_LENGTH * 4 + capacitySamples * 4;
}
