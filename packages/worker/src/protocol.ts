import type {
  DiskFormat,
  KempstonInput,
  MachineModel,
  SnapshotFormat,
  TapeFormat,
} from "@zx-spectrum/core";

export type { MachineModel, SnapshotFormat, TapeFormat, DiskFormat, KempstonInput };

export type HostToWorkerMessage =
  | { type: "init"; frameBuffer: SharedArrayBuffer | null; audioBuffer: SharedArrayBuffer | null }
  | { type: "loadRom"; model: MachineModel; rom: ArrayBuffer }
  | { type: "loadSnapshot"; format: SnapshotFormat; data: ArrayBuffer }
  | { type: "loadTape"; format: TapeFormat; data: ArrayBuffer }
  | { type: "playTape" }
  | { type: "stopTape" }
  | { type: "loadDisk"; data: ArrayBuffer }
  | { type: "ejectDisk" }
  | { type: "setTapeSound"; enabled: boolean }
  | { type: "setFastTapeLoad"; enabled: boolean }
  | { type: "setAudioMode"; mode: "mono" | "acb" | "abc" }
  | { type: "keyEvent"; row: number; bit: number; down: boolean }
  | { type: "joystickEvent"; input: KempstonInput; down: boolean }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "reset"; pageRom1?: boolean }
  | { type: "saveSnapshot"; format?: "sna" | "z80" }
  | { type: "saveState"; slot: number }
  | {
      type: "loadState";
      slot: number;
      data: ArrayBuffer;
      model: MachineModel;
      format?: "sna" | "z80" | undefined;
    }
  | {
      type: "exportState";
      data: ArrayBuffer;
      model: MachineModel;
      targetFormat: "sna" | "z80";
      inputFormat?: "sna" | "z80" | undefined;
    };

export type WorkerToHostMessage =
  | { type: "ready" }
  | { type: "frame"; pixels: ArrayBuffer; width: number; height: number; audio: ArrayBuffer }
  | { type: "tapeStatus"; playing: boolean }
  | { type: "diskStatus"; inserted: boolean; motorOn: boolean; track: number }
  | { type: "error"; message: string }
  | { type: "snapshotData"; format: "sna" | "z80"; data: ArrayBuffer }
  | { type: "stateData"; slot: number; data: ArrayBuffer; model: MachineModel };

export const MAX_FRAME_WIDTH = 512;
export const MAX_FRAME_HEIGHT = 384;
export const DEFAULT_SAMPLE_RATE = 44100;
export const AUDIO_CHANNELS = 2; // Stereo
export const AUDIO_CAPACITY_SAMPLES = 44100; // ~1s
export const AUDIO_CAPACITY_FLOATS = AUDIO_CAPACITY_SAMPLES * AUDIO_CHANNELS;
export const SPECTRUM_FPS = 50;
export const FRAME_INTERVAL_MS = 1000 / SPECTRUM_FPS;
export const SAMPLES_PER_FRAME = Math.round(DEFAULT_SAMPLE_RATE / SPECTRUM_FPS);
export const STEREO_SAMPLES_PER_FRAME = SAMPLES_PER_FRAME * AUDIO_CHANNELS;

export const FRAME_HEADER_INT32_LENGTH = 3; // [seq, width, height]

export function frameBufferByteLength(
  maxWidth = MAX_FRAME_WIDTH,
  maxHeight = MAX_FRAME_HEIGHT,
): number {
  return FRAME_HEADER_INT32_LENGTH * 4 + maxWidth * maxHeight;
}

export const AUDIO_HEADER_INT32_LENGTH = 3; // [readIndex, writeIndex, capacity]

export function audioBufferByteLength(capacityFloats = AUDIO_CAPACITY_FLOATS): number {
  return AUDIO_HEADER_INT32_LENGTH * 4 + capacityFloats * 4;
}
