export type MachineModel = "48k" | "128k" | "plus3";

export interface FrameBuffer {
  pixels: Uint8Array;
  width: number;
  height: number;
}
